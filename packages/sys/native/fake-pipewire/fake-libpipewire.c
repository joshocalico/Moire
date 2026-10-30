/*
 * Test-only fake of the libpipewire calls Moire makes, built as `libpipewire-0.3` next to a test
 * build of moire-pwring.c. A connected stream gets a data thread that calls the shim's `process`
 * every 2 ms without any lock, like PipeWire's realtime thread: playback buffers are appended to a
 * sink the test reads back; capture buffers carry a square wave of a set amplitude.
 */
/* strdup and recursive mutexes need this under glibc's strict standard modes. */
#define _GNU_SOURCE
#include <pipewire/pipewire.h>

#include <pthread.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define FAKE_FRAMES 128
#define FAKE_MAX 8192
#define SINK_MAX (1 << 20)
#define MAX_PROPS 32

struct pw_thread_loop {
	pthread_mutex_t lock;
	int started;
};

struct pw_properties {
	int n;
	char *keys[MAX_PROPS];
	char *values[MAX_PROPS];
};

struct pw_stream {
	const struct pw_stream_events *events;
	void *data;
	struct pw_properties *props;
	int direction;
	int state;
	volatile int running;
	pthread_t thread;
	struct pw_buffer pwbuf;
	struct spa_buffer buffer;
	struct spa_data datas[1];
	struct spa_chunk chunk;
	uint8_t memory[FAKE_MAX];
	int dequeued;
};

static pthread_mutex_t sink_lock = PTHREAD_MUTEX_INITIALIZER;
static uint8_t sink[SINK_MAX];
static size_t sink_len;
static uint8_t format[4096];
static uint32_t format_len;
static uint32_t connect_flags;
static int connect_direction = -1;
static volatile float capture_amplitude = 0.5f;
static int streams_alive;
static struct pw_properties last_props;
static volatile int fail_all;

void pw_init(int *argc, char ***argv)
{
	(void)argc;
	(void)argv;
}

struct pw_thread_loop *pw_thread_loop_new(const char *name, const void *props)
{
	(void)name;
	(void)props;
	struct pw_thread_loop *loop = calloc(1, sizeof(*loop));
	pthread_mutexattr_t attr;
	pthread_mutexattr_init(&attr);
	pthread_mutexattr_settype(&attr, PTHREAD_MUTEX_RECURSIVE);
	pthread_mutex_init(&loop->lock, &attr);
	return loop;
}

int pw_thread_loop_start(struct pw_thread_loop *loop)
{
	loop->started = 1;
	return 0;
}

void pw_thread_loop_lock(struct pw_thread_loop *loop)
{
	pthread_mutex_lock(&loop->lock);
}

void pw_thread_loop_unlock(struct pw_thread_loop *loop)
{
	pthread_mutex_unlock(&loop->lock);
}

void *pw_thread_loop_get_loop(struct pw_thread_loop *loop)
{
	return loop;
}

struct pw_properties *pw_properties_new(const char *key, ...)
{
	struct pw_properties *props = calloc(1, sizeof(*props));
	va_list args;
	va_start(args, key);
	while (key != NULL && props->n < MAX_PROPS) {
		const char *value = va_arg(args, const char *);
		props->keys[props->n] = strdup(key);
		props->values[props->n++] = strdup(value ? value : "");
		key = va_arg(args, const char *);
	}
	va_end(args);
	return props;
}

int pw_properties_set(struct pw_properties *props, const char *key, const char *value)
{
	if (props->n >= MAX_PROPS)
		return -1;
	props->keys[props->n] = strdup(key);
	props->values[props->n++] = strdup(value ? value : "");
	return 1;
}

static void free_props(struct pw_properties *props)
{
	for (int i = 0; i < props->n; i++) {
		free(props->keys[i]);
		free(props->values[i]);
	}
	free(props);
}

struct pw_stream *pw_stream_new_simple(void *loop, const char *name, struct pw_properties *props,
				       const struct pw_stream_events *events, void *data)
{
	(void)loop;
	(void)name;
	struct pw_stream *stream = calloc(1, sizeof(*stream));
	stream->events = events;
	stream->data = data;
	stream->props = props;
	stream->pwbuf.buffer = &stream->buffer;
	stream->buffer.n_datas = 1;
	stream->buffer.datas = stream->datas;
	stream->datas[0].maxsize = FAKE_MAX;
	stream->datas[0].data = stream->memory;
	stream->datas[0].chunk = &stream->chunk;
	streams_alive++;
	for (int i = 0; i < last_props.n; i++) {
		free(last_props.keys[i]);
		free(last_props.values[i]);
	}
	last_props.n = 0;
	for (int i = 0; i < props->n; i++) {
		last_props.keys[i] = strdup(props->keys[i]);
		last_props.values[i] = strdup(props->values[i]);
		last_props.n++;
	}
	return stream;
}

struct pw_buffer *pw_stream_dequeue_buffer(struct pw_stream *stream)
{
	if (stream->dequeued)
		return NULL;
	stream->dequeued = 1;
	return &stream->pwbuf;
}

int pw_stream_queue_buffer(struct pw_stream *stream, struct pw_buffer *buffer)
{
	(void)buffer;
	if (stream->direction == 1) {
		pthread_mutex_lock(&sink_lock);
		uint32_t size = stream->chunk.size;
		if (sink_len + size <= SINK_MAX) {
			memcpy(sink + sink_len, stream->memory + stream->chunk.offset, size);
			sink_len += size;
		}
		pthread_mutex_unlock(&sink_lock);
	}
	stream->dequeued = 0;
	return 0;
}

static void *data_thread(void *arg)
{
	struct pw_stream *stream = arg;
	struct timespec tick = { 0, 2 * 1000 * 1000 };
	while (stream->running) {
		if (stream->direction == 1) {
			stream->pwbuf.requested = FAKE_FRAMES;
		} else {
			float a = capture_amplitude;
			for (int i = 0; i < FAKE_FRAMES; i++) {
				float x = (i & 1) ? -a : a;
				memcpy(stream->memory + i * sizeof(float), &x, sizeof(x));
			}
			stream->chunk.offset = 0;
			stream->chunk.size = FAKE_FRAMES * sizeof(float);
		}
		stream->events->process(stream->data);
		nanosleep(&tick, NULL);
	}
	return NULL;
}

int pw_stream_connect(struct pw_stream *stream, int direction, uint32_t target, int flags,
		      const struct spa_pod **params, uint32_t n_params)
{
	(void)target;
	if (n_params < 1 || params == NULL || params[0] == NULL)
		return -22;
	const uint32_t *header = (const uint32_t *)params[0];
	uint32_t size = header[0] + 8;
	format_len = size < sizeof(format) ? size : 0;
	memcpy(format, params[0], format_len);
	connect_flags = (uint32_t)flags;
	connect_direction = direction;
	stream->direction = direction;
	stream->state = 3; /* streaming */
	stream->running = 1;
	pthread_create(&stream->thread, NULL, data_thread, stream);
	return 0;
}

int pw_stream_get_state(struct pw_stream *stream, const char **error)
{
	int state = fail_all ? -1 : stream->state;
	if (error)
		*error = state < 0 ? "fake failure" : NULL;
	return state;
}

int pw_stream_disconnect(struct pw_stream *stream)
{
	if (stream->running) {
		stream->running = 0;
		pthread_join(stream->thread, NULL);
	}
	stream->state = 0;
	return 0;
}

void pw_stream_destroy(struct pw_stream *stream)
{
	pw_stream_disconnect(stream);
	free_props(stream->props);
	free(stream);
	streams_alive--;
}

/* ── test hooks ── */

size_t fake_pw_sink_take(void *dst, size_t max)
{
	pthread_mutex_lock(&sink_lock);
	size_t n = sink_len < max ? sink_len : max;
	memcpy(dst, sink, n);
	memmove(sink, sink + n, sink_len - n);
	sink_len -= n;
	pthread_mutex_unlock(&sink_lock);
	return n;
}

uint32_t fake_pw_format(void *dst, uint32_t max)
{
	uint32_t n = format_len < max ? format_len : max;
	memcpy(dst, format, n);
	return n;
}

uint32_t fake_pw_connect_flags(void)
{
	return connect_flags;
}

int fake_pw_connect_direction(void)
{
	return connect_direction;
}

void fake_pw_set_capture_amplitude(float amplitude)
{
	capture_amplitude = amplitude;
}

int fake_pw_streams_alive(void)
{
	return streams_alive;
}

const char *fake_pw_prop(const char *key)
{
	for (int i = 0; i < last_props.n; i++)
		if (strcmp(last_props.keys[i], key) == 0)
			return last_props.values[i];
	return NULL;
}

void fake_pw_fail_all(int fail)
{
	fail_all = fail;
}
