/*
 * Test-only stand-in for <pipewire/pipewire.h>: just the declarations moire-pwring.c uses, with
 * PipeWire 1.x field order. Lets the shim build and run against fake-libpipewire.c on hosts
 * without PipeWire (the Mac); the image builds it against the real headers.
 */
#ifndef MOIRE_FAKE_PIPEWIRE_H
#define MOIRE_FAKE_PIPEWIRE_H

#include <stdint.h>

struct spa_chunk {
	uint32_t offset;
	uint32_t size;
	int32_t stride;
	int32_t flags;
};

struct spa_data {
	uint32_t type;
	uint32_t flags;
	int64_t fd;
	uint32_t mapoffset;
	uint32_t maxsize;
	void *data;
	struct spa_chunk *chunk;
};

struct spa_buffer {
	uint32_t n_metas;
	uint32_t n_datas;
	void *metas;
	struct spa_data *datas;
};

struct pw_buffer {
	struct spa_buffer *buffer;
	void *user_data;
	uint64_t size;
	uint64_t requested;
	uint64_t time;
};

struct pw_stream;
struct spa_pod;

#define PW_VERSION_STREAM_EVENTS 2

struct pw_stream_events {
	uint32_t version;
	void (*destroy)(void *data);
	void (*state_changed)(void *data, int old, int state, const char *error);
	void (*control_info)(void *data, uint32_t id, const void *control);
	void (*io_changed)(void *data, uint32_t id, void *area, uint32_t size);
	void (*param_changed)(void *data, uint32_t id, const struct spa_pod *param);
	void (*add_buffer)(void *data, struct pw_buffer *buffer);
	void (*remove_buffer)(void *data, struct pw_buffer *buffer);
	void (*process)(void *data);
	void (*drained)(void *data);
	void (*command)(void *data, const void *command);
	void (*trigger_done)(void *data);
};

struct pw_buffer *pw_stream_dequeue_buffer(struct pw_stream *stream);
int pw_stream_queue_buffer(struct pw_stream *stream, struct pw_buffer *buffer);

#endif
