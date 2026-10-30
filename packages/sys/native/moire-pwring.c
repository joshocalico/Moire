/*
 * libmoire-pwring: the realtime half of Moire's PipeWire streams. Reviewed C, kept tiny.
 *
 * PipeWire calls a stream's `process` on its realtime data thread. A koffi callback there would
 * block that thread until the JS event loop ran it (and could deadlock against the thread-loop
 * lock), so no JS is ever registered with libpipewire. Instead `process` lives here and moves
 * audio between the stream's buffers and a lock-free single-producer/single-consumer ring in
 * native memory that JS fills or drains with ordinary synchronous calls. See docs/audio.md.
 *
 * Rules for this file: nothing in `process` allocates, locks, logs or makes a syscall; every
 * size is clamped to the buffer; frames are moved whole.
 */

/* PipeWire's headers use locale_t/newlocale, which glibc only declares with this set. */
#define _GNU_SOURCE
#include <pipewire/pipewire.h>

#include <math.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define API __attribute__((visibility("default")))

/* Indices count bytes and wrap at 2^32; capacity is a power of two, so `head - tail` is the fill. */
struct moire_pwring {
	_Atomic uint32_t head; /* producer: bytes written */
	_Atomic uint32_t tail; /* consumer: bytes read */
	uint32_t capacity;
	uint32_t stride; /* bytes per frame */
	_Atomic uint32_t started; /* playback: audio has reached PipeWire */
	_Atomic uint32_t finished; /* playback: the producer has no more audio */
	_Atomic uint64_t frames; /* frames moved by process */
	_Atomic uint64_t underruns;
	_Atomic uint64_t overruns;
	_Atomic uint32_t peak_bits; /* capture: max |sample| as float bits */
	_Atomic uint64_t sum_squares; /* capture: sum of squares, 32.32 fixed point */
	_Atomic uint64_t samples;
	struct pw_stream *stream;
	uint8_t *data;
};

#define MIN_CAPACITY 4096u
#define MAX_CAPACITY (1u << 26)
#define MAX_SAMPLE 4.0f

API struct moire_pwring *moire_pwring_new(uint32_t capacity, uint32_t stride)
{
	if (stride == 0 || stride > 64 || capacity > MAX_CAPACITY)
		return NULL;
	struct moire_pwring *r = calloc(1, sizeof(*r));
	if (r == NULL)
		return NULL;
	r->stride = stride;
	if (capacity > 0) {
		uint32_t size = MIN_CAPACITY;
		while (size < capacity)
			size <<= 1;
		r->data = calloc(1, size);
		if (r->data == NULL) {
			free(r);
			return NULL;
		}
		r->capacity = size;
	}
	return r;
}

/* Only after pw_stream_destroy: process must never run again. */
API void moire_pwring_free(struct moire_pwring *r)
{
	if (r == NULL)
		return;
	free(r->data);
	free(r);
}

/* Before pw_stream_connect; process reads it without synchronisation. */
API void moire_pwring_attach(struct moire_pwring *r, struct pw_stream *stream)
{
	r->stream = stream;
}

API void moire_pwring_finish(struct moire_pwring *r)
{
	atomic_store_explicit(&r->finished, 1, memory_order_release);
}

API uint32_t moire_pwring_readable(struct moire_pwring *r)
{
	return atomic_load_explicit(&r->head, memory_order_acquire) -
	       atomic_load_explicit(&r->tail, memory_order_relaxed);
}

API uint32_t moire_pwring_writable(struct moire_pwring *r)
{
	return r->capacity - (atomic_load_explicit(&r->head, memory_order_relaxed) -
			      atomic_load_explicit(&r->tail, memory_order_acquire));
}

/* Producer side. Returns the bytes taken: whole frames, as many as fit. */
API uint32_t moire_pwring_write(struct moire_pwring *r, const void *src, uint32_t bytes)
{
	uint32_t head = atomic_load_explicit(&r->head, memory_order_relaxed);
	uint32_t tail = atomic_load_explicit(&r->tail, memory_order_acquire);
	uint32_t space = r->capacity - (head - tail);
	if (bytes > space)
		bytes = space;
	bytes -= bytes % r->stride;
	if (bytes == 0)
		return 0;
	uint32_t at = head & (r->capacity - 1);
	uint32_t first = r->capacity - at < bytes ? r->capacity - at : bytes;
	memcpy(r->data + at, src, first);
	memcpy(r->data, (const uint8_t *)src + first, bytes - first);
	atomic_store_explicit(&r->head, head + bytes, memory_order_release);
	return bytes;
}

/* Consumer side. Returns the bytes copied: whole frames, as many as are there. */
API uint32_t moire_pwring_read(struct moire_pwring *r, void *dst, uint32_t bytes)
{
	uint32_t tail = atomic_load_explicit(&r->tail, memory_order_relaxed);
	uint32_t head = atomic_load_explicit(&r->head, memory_order_acquire);
	uint32_t fill = head - tail;
	if (bytes > fill)
		bytes = fill;
	bytes -= bytes % r->stride;
	if (bytes == 0)
		return 0;
	uint32_t at = tail & (r->capacity - 1);
	uint32_t first = r->capacity - at < bytes ? r->capacity - at : bytes;
	memcpy(dst, r->data + at, first);
	memcpy((uint8_t *)dst + first, r->data, bytes - first);
	atomic_store_explicit(&r->tail, tail + bytes, memory_order_release);
	return bytes;
}

/* out[0] frames, out[1] underruns, out[2] overruns. */
API void moire_pwring_counters(struct moire_pwring *r, uint64_t *out)
{
	out[0] = atomic_load_explicit(&r->frames, memory_order_relaxed);
	out[1] = atomic_load_explicit(&r->underruns, memory_order_relaxed);
	out[2] = atomic_load_explicit(&r->overruns, memory_order_relaxed);
}

/*
 * out[0] peak, out[1] RMS since the last take; returns the samples they cover. The three
 * exchanges are separate, so one buffer can land between them and shift to the next take.
 */
API uint64_t moire_pwring_take_levels(struct moire_pwring *r, float *out)
{
	uint32_t bits = atomic_exchange_explicit(&r->peak_bits, 0, memory_order_relaxed);
	uint64_t sum = atomic_exchange_explicit(&r->sum_squares, 0, memory_order_relaxed);
	uint64_t n = atomic_exchange_explicit(&r->samples, 0, memory_order_relaxed);
	float peak;
	memcpy(&peak, &bits, sizeof(peak));
	out[0] = peak;
	out[1] = n ? (float)sqrt((double)sum / 4294967296.0 / (double)n) : 0.0f;
	return n;
}

static void fold_levels(struct moire_pwring *r, const uint8_t *bytes, uint32_t count)
{
	float peak = 0.0f;
	double sum = 0.0;
	for (uint32_t i = 0; i < count; i++) {
		float x;
		memcpy(&x, bytes + i * sizeof(float), sizeof(x));
		float a = fabsf(x);
		if (!(a <= MAX_SAMPLE)) /* also catches NaN */
			a = MAX_SAMPLE;
		if (a > peak)
			peak = a;
		sum += (double)a * a;
	}
	/* Non-negative IEEE floats order like their bit patterns, so an integer max is exact. */
	uint32_t bits;
	memcpy(&bits, &peak, sizeof(bits));
	uint32_t seen = atomic_load_explicit(&r->peak_bits, memory_order_relaxed);
	while (bits > seen &&
	       !atomic_compare_exchange_weak_explicit(&r->peak_bits, &seen, bits,
						      memory_order_relaxed, memory_order_relaxed))
		;
	atomic_fetch_add_explicit(&r->sum_squares, (uint64_t)(sum * 4294967296.0),
				  memory_order_relaxed);
	atomic_fetch_add_explicit(&r->samples, count, memory_order_relaxed);
}

static void on_playback(void *data)
{
	struct moire_pwring *r = data;
	struct pw_buffer *b = pw_stream_dequeue_buffer(r->stream);
	if (b == NULL)
		return;
	struct spa_buffer *buf = b->buffer;
	if (buf->n_datas > 0 && buf->datas[0].data != NULL && buf->datas[0].chunk != NULL) {
		struct spa_data *d = &buf->datas[0];
		uint32_t want = d->maxsize - d->maxsize % r->stride;
		if (b->requested > 0 && b->requested * r->stride < want)
			want = (uint32_t)(b->requested * r->stride);
		uint32_t got = r->capacity ? moire_pwring_read(r, d->data, want) : 0;
		if (got < want) {
			memset((uint8_t *)d->data + got, 0, want - got);
			if (atomic_load_explicit(&r->started, memory_order_relaxed) &&
			    !atomic_load_explicit(&r->finished, memory_order_acquire))
				atomic_fetch_add_explicit(&r->underruns, 1, memory_order_relaxed);
		}
		if (got > 0)
			atomic_store_explicit(&r->started, 1, memory_order_relaxed);
		atomic_fetch_add_explicit(&r->frames, got / r->stride, memory_order_relaxed);
		d->chunk->offset = 0;
		d->chunk->stride = (int32_t)r->stride;
		d->chunk->size = want;
	}
	pw_stream_queue_buffer(r->stream, b);
}

/* Capture is always F32: levels are folded per sample; audio goes to the ring if it fits. */
static void on_capture(void *data)
{
	struct moire_pwring *r = data;
	struct pw_buffer *b = pw_stream_dequeue_buffer(r->stream);
	if (b == NULL)
		return;
	struct spa_buffer *buf = b->buffer;
	if (buf->n_datas > 0 && buf->datas[0].data != NULL && buf->datas[0].chunk != NULL) {
		struct spa_data *d = &buf->datas[0];
		uint32_t offset = d->chunk->offset < d->maxsize ? d->chunk->offset : d->maxsize;
		uint32_t size = d->chunk->size < d->maxsize - offset ? d->chunk->size : d->maxsize - offset;
		size -= size % r->stride;
		const uint8_t *bytes = (const uint8_t *)d->data + offset;
		fold_levels(r, bytes, size / sizeof(float));
		if (r->capacity > 0 && size > 0) {
			if (moire_pwring_writable(r) >= size)
				moire_pwring_write(r, bytes, size);
			else
				atomic_fetch_add_explicit(&r->overruns, 1, memory_order_relaxed);
		}
		atomic_fetch_add_explicit(&r->frames, size / r->stride, memory_order_relaxed);
	}
	pw_stream_queue_buffer(r->stream, b);
}

static const struct pw_stream_events playback_events = {
	.version = PW_VERSION_STREAM_EVENTS,
	.process = on_playback,
};

static const struct pw_stream_events capture_events = {
	.version = PW_VERSION_STREAM_EVENTS,
	.process = on_capture,
};

API const struct pw_stream_events *moire_pwring_playback_events(void)
{
	return &playback_events;
}

API const struct pw_stream_events *moire_pwring_capture_events(void)
{
	return &capture_events;
}
