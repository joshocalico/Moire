#!/usr/bin/env python3
"""Send absolute pointer input to an owned native test guest at 1280x800.

Requires its private UNIX QMP socket. Does not build/launch guests or perform
VM lifecycle operations. Evidence contains pointer coordinates and QMP replies.
"""
import argparse
import json
import os
import socket
import stat
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--socket', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('action', choices=['query', 'move', 'click', 'double-click'])
    parser.add_argument('x', type=int, nargs='?')
    parser.add_argument('y', type=int, nargs='?')
    args = parser.parse_args()
    if args.action == 'query':
        if args.x is not None or args.y is not None:
            parser.error('query does not take coordinates')
    elif (args.x is None or args.y is None or
          not 0 <= args.x < 1280 or not 0 <= args.y < 800):
        parser.error('expected guest pixel coordinates within 1280x800')
    socket_stat = args.socket.stat()
    if not stat.S_ISSOCK(socket_stat.st_mode) or socket_stat.st_uid != os.getuid():
        parser.error('expected an owned UNIX QMP socket')
    args.evidence.mkdir(parents=True, exist_ok=True)

    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(5)
        client.connect(str(args.socket))
        with client.makefile('rwb') as stream:
            greeting = json.loads(stream.readline())
            if 'QMP' not in greeting:
                raise RuntimeError('expected QMP greeting')
            serial = 0

            def command(name, arguments=None):
                nonlocal serial
                serial += 1
                request = {'execute': name, 'id': serial}
                if arguments is not None:
                    request['arguments'] = arguments
                stream.write((json.dumps(request) + '\n').encode())
                stream.flush()
                while True:
                    line = stream.readline()
                    if not line:
                        raise RuntimeError('QMP disconnected before reply')
                    reply = json.loads(line)
                    if reply.get('id') == serial:
                        break
                with (args.evidence / 'pointer-commands.jsonl').open('a') as log:
                    log.write(json.dumps({
                        'unix': time.time(), 'request': request, 'reply': reply,
                    }) + '\n')
                if 'return' not in reply:
                    raise RuntimeError(f'QMP command rejected: {reply}')
                return reply['return']

            command('qmp_capabilities')
            mice = command('query-mice')
            if not any(mouse.get('current') and mouse.get('absolute') for mouse in mice):
                raise RuntimeError('no current absolute pointer device')
            if args.action == 'query':
                print(json.dumps({'version': greeting['QMP']['version'], 'mice': mice}))
                return
            absolute = [
                {'type': 'abs', 'data': {'axis': 'x', 'value': round(args.x / 1280 * 32767)}},
                {'type': 'abs', 'data': {'axis': 'y', 'value': round(args.y / 800 * 32767)}},
            ]
            # A new compositor forgets its pointer position, but the virtio tablet
            # suppresses unchanged axes. Force fresh axis events before a repeated
            # target, including after login/logout, without clicking elsewhere.
            nudge = [
                {'type': 'abs', 'data': {'axis': 'x', 'value': round((args.x + 1 if args.x < 1279 else args.x - 1) / 1280 * 32767)}},
                {'type': 'abs', 'data': {'axis': 'y', 'value': round((args.y + 1 if args.y < 799 else args.y - 1) / 800 * 32767)}},
            ]
            command('input-send-event', {'events': nudge})
            command('input-send-event', {'events': absolute})
            time.sleep(.2)
            if args.action != 'move':
                for _ in range(2 if args.action == 'double-click' else 1):
                    command('input-send-event', {'events': [
                        {'type': 'btn', 'data': {'button': 'left', 'down': True}},
                    ]})
                    time.sleep(.06)
                    command('input-send-event', {'events': [
                        {'type': 'btn', 'data': {'button': 'left', 'down': False}},
                    ]})
                    time.sleep(.12)
            print(json.dumps({
                'action': args.action, 'guestPixels': [args.x, args.y],
                'absoluteEvents': absolute,
            }))


if __name__ == '__main__':
    main()
