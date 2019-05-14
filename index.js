// imports
const net = require('net');
const { Transform } = require('stream');
const uuid = require('uuid/v4');
const EventEmitter = require('events');

// constants
const SMALL = 1;
const NORMAL = 2;
const LARGE = 4;
const DEFAULT_PORT = 3000;

// functions
function maxMessageLength(headerPrefixLength) {
	return Math.pow(2, 8 * headerPrefixLength);
}

class JsonTransformer extends Transform {
	constructor(headerPrefixLength) {
		super({ readableObjectMode: true });
		this.buffer = Buffer.alloc(0);
		this.headerPrefixLength = headerPrefixLength;
		this._readHeader = {
			1: 'readUInt8',
			2: 'readUInt16BE',
			4: 'readUInt32BE'
		}[this.headerPrefixLength];
	}

	_transform(chunk, encoding, callback) {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		if (this.buffer.length > this.headerPrefixLength) {
			const bytes = this.buffer[this._readHeader](0);
			if (this.buffer.length >= bytes + this.headerPrefixLength) {
				const json = this.buffer.toString(
					'utf8',
					this.headerPrefixLength,
					this.bytes
				);

				this.buffer = this.buffer.slice(bytes + this.headerPrefixLength);

				try {
					this.push(JSON.parse(json));
				} catch (err) {
					this.emit('error', err);
				}
				callback();
			}
		} else {
			callback();
		}
	}
}

class MyEmitter extends EventEmitter {
	constructor() {
		super();
	}
}

function createServer(options = {}) {
	const headerPrefixLength = options.headerPrefixLength || SMALL;
	const emitter = new MyEmitter();
	const server = net.createServer(socket => {
		const toJson = new JsonTransformer(headerPrefixLength);
		const send = id => (message, callback) => {
			message.id = id;
			const messageAsString = JSON.stringify(message);
			const messageLength = Buffer.byteLength(messageAsString);

			if (messageLength > maxMessageLength(headerPrefixLength)) {
				throw new Error(
					'Maximum message length exceeded. Increase the headerPrefixLength.'
				);
			}

			const writeBytes = {
				1: 'writeUInt8',
				2: 'writeUInt16BE',
				4: 'writeUInt32BE'
			}[headerPrefixLength];
			const buffer = Buffer.alloc(headerPrefixLength + messageLength);
			buffer[writeBytes](messageLength, 0);
			buffer.write(messageAsString, headerPrefixLength);
			socket.write(buffer);
		};

		socket.on('close', hadError => {
			console.log('socket closed: %s', hadError);
		});

		socket.on('connect', () => {
			console.log('socket connected');
		});

		socket.on('drain', () => {
			console.log('socket drained');
		});

		socket.on('end', () => {
			console.log('socket ended');
		});

		socket.on('error', err => {
			console.log('socket error: %j', err);
		});

		socket.pipe(toJson).on('data', message => {
			if (message.type) {
				emitter.emit(message.type, message, send(message.id));
			} else {
				emitter.emit('message', message, send(message.id));
			}
		});
	});

	emitter.listen = port => {
		server.listen(port);
	};

	return emitter;
}

function createClient(options, handler) {
	if (!handler) {
		handler = options;
		options = {};
	}
	const host = options.host;
	const port = options.port || DEFAULT_PORT;
	const headerPrefixLength = options.headerPrefixLength || SMALL;
	const callbacks = new Map();
	const toJson = new JsonTransformer(headerPrefixLength);

	const client = net.createConnection({ host, port }, () => {
		console.log('tcp.createClient - connected to server');
		function send(message, callback) {
			if (!message.id) {
				message.id = uuid();
			}

			const messageAsString = JSON.stringify(message);
			const messageLength = Buffer.byteLength(messageAsString);

			if (messageLength > maxMessageLength(headerPrefixLength)) {
				throw new Error(
					'Maximum message length exceeded. Increase the headerPrefixLength.'
				);
			}

			const writeBytes = {
				1: 'writeUInt8',
				2: 'writeUInt16BE',
				4: 'writeUInt32BE'
			}[headerPrefixLength];
			const buffer = Buffer.alloc(headerPrefixLength + messageLength);
			buffer[writeBytes](messageLength, 0);
			buffer.write(messageAsString, headerPrefixLength);
			client.write(buffer);
			callbacks.set(message.id, callback);
		}
		handler(send);
	});
	client.pipe(toJson).on('data', message => {
		if (message.id && callbacks.has(message.id)) {
			callbacks.get(message.id)(null, message);
			callbacks.delete(message.id);
		}
	});

	return client;
}
module.exports = {
	createServer,
	createClient
};
