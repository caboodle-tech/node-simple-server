/* eslint-disable no-console */
/* eslint-disable func-names */
/* eslint-disable no-shadow */

const FS = require('fs');
const Http = require('http');
const OS = require('os');
const Path = require('path');
const WebSocket = require('ws');
const HTTPStatus = require('./js/http-status');
const ContentTypes = require('./js/content-types');

/**
 * The Node Simple Server (NSS) application.
 *
 * @param {Object} options The settings to use, uses defaults set in OP if missing.
 * @return {Object} A new NSS object with public methods exposed.
 */
function NodeSimpleServer(options) {

    /* NSS global variables. */
    const CONNECTIONS = {};
    const OP = {
        callbacks: {},
        contentType: 'text/html',
        dirListing: false,
        indexPage: 'index.html',
        port: 5000,
        root: Path.normalize(`${process.cwd()}/`),
        running: false
    };
    const SEP = Path.sep;
    let SERVER = null;
    let SOCKET = null;
    const VERSION = '0.1.0-rc'; // Update on releases.

    /**
     * NSS relies on a set pattern for URLs to make comparing them easy.
     *
     * @param {String} url The url to convert into the expected format.
     * @return {String} A url that has been formatted to work with NSS.
     */
    const correctURL = function (url) {
        // Make sure we have a URL and it starts correctly.
        url = url || '/';
        if (url[0] !== '/') {
            url = `/${url}`;
        }
        // Make sure the URL ends correctly.
        if (url.substr(-3) !== '/ws') {
            url += '/ws';
        }
        return url;
    };

    /**
     * Get the contents of a directory for displaying in the directory listing page.
     *
     * @param {String} location The directory to search.
     * @return {Array} The html for files [0] and directories [1] found.
     */
    const getDirList = function (location) {
        // Get all directories and files at this location.
        const files = [];
        const dirs = [];
        FS.readdirSync(location).forEach((item) => {
            if (FS.lstatSync(Path.join(location, item)).isDirectory()) {
                dirs.push(item);
            } else {
                files.push(item);
            }
        });
        files.sort((a, b) => a.localeCompare(b));
        dirs.sort((a, b) => a.localeCompare(b));
        // Build the innerHTML for the directory and files unordered list.
        let fileHtml = '';
        let dirHtml = '';
        // Replace files in the directory listing template.
        files.forEach((file) => {
            const relative = Path.join(location, file).replace(OP.root, '');
            fileHtml += `<li><a href="${relative}">${file}</a></li>`;
        });
        // Add the go back link (parent directory) for nested directories.
        if (location.replace(OP.root, '').length > 0) {
            dirHtml += '<li><a href="../">../</a></li>';
        }
        // Replace directories in the directory listing template.
        dirs.forEach((dir) => {
            const relative = Path.join(location, dir).replace(OP.root, '');
            dirHtml += `<li><a href="${relative}">${dir}</a></li>`;
        });
        return [fileHtml, dirHtml];
    };

    /**
     * Determine a files last modified time and report it in the format expected
     * by the HTTP Last-Modified header. {@link https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Last-Modified| See standard}.
     *
     * @param {String} date A time string representing the last modification of this file.
     * @return {String} <day-name>, <day> <month> <year> <hour>:<minute>:<second> GMT
     */
    const getLastModified = function (date) {
        // Use the current time if no time was passed in.
        let timestamp = new Date();
        if (date) {
            timestamp = new Date(Date.parse(date));
        }
        // Build and return the timestamp.
        const dayAry = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const monthAry = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const dayStr = dayAry[timestamp.getUTCDay()];
        const monStr = monthAry[timestamp.getUTCMonth()];
        let dayNum = timestamp.getUTCDate();
        let hour = timestamp.getUTCHours();
        let minute = timestamp.getUTCMinutes();
        let second = timestamp.getUTCSeconds();
        if (dayNum.length < 10) {
            dayNum = `0${dayNum}`;
        }
        if (hour.length < 10) {
            hour = `0${hour}`;
        }
        if (minute.length < 10) {
            minute = `0${minute}`;
        }
        if (second.length < 10) {
            second = `0${second}`;
        }
        return `${dayStr}, ${dayNum} ${monStr} ${timestamp.getUTCFullYear()} ${hour}:${minute}:${second} GMT`;
    };

    /**
     * Get all IP addresses that are considered external on this machine; the server will
     * attempt to listen to the requested port on these addresses as well, allowing you to
     * view the site from other devices on the same network. {@link https://github.com/nisaacson/interface-addresses| Source of code}.
     *
     * @author Noah Isaacson
     * @return {Object} An object of interface names [key] and their IPv4 IP addresses [value].
     */
    const getLocalAddress = function () {
        const addresses = {};
        const interfaces = OS.networkInterfaces();
        Object.keys(interfaces).filter((key) => {
            const items = interfaces[key];
            return items.forEach((item) => {
                const family = item.family;
                if (family !== 'IPv4') {
                    return false;
                }
                const internal = item.internal;
                if (internal) {
                    return false;
                }
                const address = item.address;
                addresses[key] = address;
                return true;
            });
        });
        return addresses;
    };

    /**
     * Create the HTTP headers object for the specified file if any.
     *
     * @param {String} contentType The content type to use otherwise use OP.contentType.
     * @param {String} file The file to build headers for; defaults will be used if missing.
     * @return {Object} The HTTP header object.
     */
    const getHeaders = function (contentType, file) {
        // Create the header object and set the Content-Type.
        const headers = {};
        contentType = contentType || OP.contentType;
        headers['Content-Type'] = `${contentType}; charset=UTF-8`;
        // Standard headers that should always be set for NSS.
        let mtime = '';
        if (file) {
            mtime = FS.statSync(file).mtime;
        }
        const nssHeaders = {
            'Cache-Control': 'public, max-age=0',
            'Last-Modified': getLastModified(mtime),
            // eslint-disable-next-line quote-props
            'Vary': 'Origin',
            'X-Powered-By': `NodeSimpleServer ${VERSION}`
        };
        // Combine the headers and return the header object.
        return Object.assign(headers, nssHeaders);
    };

    /**
     * Initialize the application and change default settings as requested.
     *
     * @param {Object} options The settings you would like to use instead of NSS's defaults.
     */
    const initialize = function (options) {
        options = options || {};
        if (options.disableAutoRestart) {
            OP.disableAutoRestart = true;
        }
        if (options.contentType) {
            OP.contentType = options.contentType;
        }
        if (options.dirListing) {
            OP.dirListing = options.dirListing;
        }
        if (options.port) {
            OP.port = options.port;
        }
        if (options.root) {
            OP.root = options.root;
            if (OP.root[OP.root.length - 1] !== SEP) {
                OP.root += SEP;
            }
        }
    };

    /**
     * Message a font-end page via the WebSocket connection if the page is currently connected.
     *
     * @param {String} url The page to message using its URL minus the domain name and port number.
     * @param {String|*} msg The message you would like to send, usually a stringified JSON object.
     * @return {Boolean} True if the page is connected and the message was sent, false otherwise.
     */
    const message = function (url, msg) {
        url = correctURL(url);
        // Attempt to find the requested page and message it.
        const keys = Object.keys(CONNECTIONS);
        for (let i = 0; i < keys.length; i++) {
            if (url === keys[i]) {
                CONNECTIONS[keys[i]].forEach((socket) => {
                    socket.send(msg);
                });
                return true;
            }
        }
        return false;
    };

    /**
     * Register a back-end function to call when a front-end page messages in. This will
     * allow you to have two way communications with a page as long as you registered
     * a function on the front-end as well.
     *
     * @param {String} url The page to listen for using its URL; do not include the
     *                     domain name and port number.
     * @param {Function} callback The function to call if this page (url) messages.
     * @return {Boolean} True is the function was registered, false otherwise.
     */
    const registerCallback = function (url, callback) {
        if (typeof callback === 'function') {
            url = correctURL(url);
            if (OP.callbacks[url]) {
                OP.callbacks[url].push(callback);
            } else {
                OP.callbacks[url] = [callback];
            }
            return true;
        }
        return false;
    };

    /**
     * Send the reload message to all connected pages.
     */
    const reloadPages = function () {
        // Send the reload message to all connections.
        const keys = Object.keys(CONNECTIONS);
        keys.forEach((key) => {
            CONNECTIONS[key].forEach((socket) => {
                socket.send('reload');
            });
        });
    };

    /**
     * Send the refreshCSS message to all connected pages; this reloads on the CSS
     * and not the whole page.
     */
    const reloadStyles = function () {
        // Send the refreshCSS message to all connections.
        const keys = Object.keys(CONNECTIONS);
        keys.forEach((key) => {
            CONNECTIONS[key].forEach((socket) => {
                socket.send('refreshCSS');
            });
        });
    };

    /**
     * The server listener for NSS, all HTTP requests are handled here.
     *
     * @param {Object} request The HTTP request object.
     * @param {Object} response The HTTP response object waiting for communication back.
     * @return {null} Used only as a short circuit.
     */
    const serverListener = function (request, response) {

        const requestURL = request.url.replace(OP.root, '').replace(/(\.{1,2}[\\/])/g, '');
        let safeURL = Path.normalize(Path.join(OP.root, requestURL.split(/[?#]/)[0]));
        const filename = Path.basename(safeURL);

        if (filename === 'websocket.ws') {
            /*
             * ERROR: This should never trigger! If it does that means the server has an issue.
             * We can try and send back a 100 to save the socket connection but we might be
             * toast, http.createServer is having issues on this machine/ network.
             */
            response.writeHead(HTTPStatus.continue, getHeaders('text/plain'));
            return;
        }

        // If accessing a directory that has an OP.indexPage route users to that page instead.
        if (FS.lstatSync(safeURL).isDirectory()) {
            const index = Path.join(safeURL, OP.indexPage);
            if (FS.existsSync(index)) {
                safeURL = index;
            }
        }

        // Make sure we have permissions to view this page and then show it if we can.
        FS.access(safeURL, FS.constants.R_OK, (exists) => {

            // 404 page not found.
            if (exists !== null) {
                // If this 404 error is for a missing favicon use NSS's default.
                if (filename === 'favicon.ico') {
                    const buffer = FS.readFileSync(Path.normalize(`${__dirname}/sources/favicon.ico`), { encoding: 'utf8', flag: 'r' });
                    response.writeHead(HTTPStatus.found, getHeaders('image/x-icon'));
                    response.write(buffer);
                } else {
                    response.writeHead(HTTPStatus.notFound, getHeaders('text/html'));
                    response.write('<h1>404 Page Not Found</h1>');
                    response.write(`<p>The requested URL ${safeURL.replace(OP.root, '')} was not found on this server.</p>`);
                }
                response.end();
                return;
            }

            // Pull in the inject script now because we may need it for a directory listing page.
            const injectScript = Path.normalize(`${__dirname}/sources/socket.html`);
            const inject = FS.readFileSync(injectScript, { encoding: 'utf8', flag: 'r' });

            // Directory stop processing and show directory listing if enabled.
            if (FS.lstatSync(safeURL).isDirectory()) {
                if (OP.dirListing) {
                    const buffer = FS.readFileSync(Path.normalize(`${__dirname}/sources/dir-listing.html`), { encoding: 'utf8', flag: 'r' });
                    let html = buffer.toString();
                    const path = `/${safeURL.replace(OP.root, '')}`;
                    const [fileList, dirList] = getDirList(safeURL);
                    html = html.replace('${path}', path);
                    html = html.replace('${files}', fileList);
                    html = html.replace('${directories}', dirList);
                    response.writeHead(HTTPStatus.ok, getHeaders('text/html'));
                    response.write(html);
                    response.write(inject);
                } else {
                    response.writeHead(HTTPStatus.forbidden, getHeaders('text/html'));
                    response.write('<h1>Forbidden</h1>');
                    response.write(`<p>You do not have permission to access ${safeURL.replace(OP.root, '')} on this server.</p>`);
                    response.write('<p>Directory listing disabled.</p>');
                }
                response.end();
                return;
            }

            // Actual file we can attempt to serve it.
            FS.readFile(safeURL, 'binary', (err, file) => {

                // 500 server error.
                if (err) {
                    // Put the error in the browser
                    response.writeHead(HTTPStatus.error, getHeaders('text/plain'));
                    response.write(`${err}\n`);
                    response.end();
                    return;
                }

                // If the requested file has a matching MIME-Type use it or use the default;
                let contentType = ContentTypes[Path.extname(safeURL)];
                if (!contentType) {
                    contentType = OP.contentType;
                }

                // Output the file to the browser.
                response.writeHead(HTTPStatus.ok, getHeaders(contentType, safeURL));
                response.write(file, 'binary');

                // Inject NSS's WebSocket at the end of the page and close initial connection.
                response.write(inject);
                response.end();

            });

        });
    };

    /**
     * The WebSocket listener for NSS, all WebSocket requests are handled here.
     *
     * @param {Object} socket The WebSocket object for this connection.
     * @param {Object} request The incoming initial connection.
     */
    const socketListener = function (socket, request) {

        // Record new socket connections.
        const url = request.url;
        if (CONNECTIONS[url]) {
            CONNECTIONS[url].push(socket); // This page has opened multiple times.
        } else {
            CONNECTIONS[url] = [socket]; // Fist time we've seen this page.
        }

        // If auto restart is supposed to be disabled tell the page now.
        if (OP.disableAutoRestart && OP.disableAutoRestart === true) {
            socket.send('disableAutoRestart');
        }

        // Handle future incoming WebSocket messages from this page.
        socket.on('message', (message) => {
            // See if the message belongs to a callback and send it there.
            if (OP.callbacks[url]) {
                OP.callbacks[url].forEach((callback) => {
                    callback(message);
                });
                return;
            }
            // No one is listening for this message.
            const cleanURL = url.substr(0, url.lastIndexOf('/ws'));
            console.log(`Unanswered WebSocket message from ${cleanURL}: ${message.toString()}`);
        });

    };

    /**
     * Attempt to start the HTTP server and WebSocket listener.
     *
     * @param {Int|null} port Allows force overriding of port number; you should usually not use
*                            this, it's meant to be used internally to NSS.
     * @return {null} Used only as a short circuit.
     */
    const start = function (port) {

        if (OP.running) {
            console.log('Server is already running.');
            return;
        }

        // Create the HTTP server.
        SERVER = Http.createServer(serverListener);
        // Capture connection upgrade requests so we don't break WebSocket connections.
        SERVER.on('upgrade', (request, socket) => {
            /*
             * Node's http server is capable of handling websocket but you have to manually
             * handle a lot of work like the handshakes. We use WebSocket.Server to avoid
             * having to do all that extra work. See the following if you want to handle
             * websocket without the WebSocket module:
             * https://medium.com/hackernoon/implementing-a-websocket-server-with-node-js-d9b78ec5ffa8
             *
             * SERVER.upgrade will clash with SOCKET.connection by running first. Currently
             * SERVER.upgrade is not used but in case we do in the future ignore all websocket
             * requests so they get passed on to the SOCKET.connection listener.
             */
            if (request.headers.upgrade === 'websocket') {
                // eslint-disable-next-line no-useless-return
                return;
            }
        });
        // Capture server errors and respond as needed.
        SERVER.on('error', (error) => {
            // The port we tried to use is taken, increment and try to start again.
            if (error.code === 'EADDRINUSE') {
                if (port) {
                    start(port + 1);
                } else {
                    start(OP.port + 1);
                }
            }
        });

        // Attempt to start the server now.
        port = port || OP.port;
        SERVER.listen(port, () => {
            // Server started successfully without error.
            OP.running = true;

            // Start the WebSocket Server on the same port.
            SOCKET = new WebSocket.Server({ server: SERVER });
            SOCKET.on('connection', socketListener);

            // Warn the user if we had to change port numbers.
            if (port && (port !== OP.port)) {
                console.log(`Port ${OP.port} was in use, switched to using ${port}.\n`);
            }

            // Log the ip addresses being watched.
            const networkIP = getLocalAddress();
            console.log('Node Simple Server live @:');
            console.log(`    http://127.0.0.1:${port}`);
            console.log(`    http://localhost:${port}`);
            Object.keys(networkIP).forEach((key) => {
                console.log(`    http://${networkIP[key]}:${port}`);
            });
            console.log('');
        });
    };

    /**
     * Stop the HTTP server and WebSocket listener gracefully.
     */
    const stop = function () {
        if (OP.running) {
            // Close all socket connections; these will keep the server up.
            const keys = Object.keys(CONNECTIONS);
            keys.forEach((key) => {
                CONNECTIONS[key].forEach((socket) => {
                    socket.send('close');
                    socket.close();
                });
            });
            // Now gracefully close SERVER and SOCKET.
            SERVER.close();
            SOCKET.close();
            // Reset NSS.
            SERVER = null;
            SOCKET = null;
        }
        console.log('Server has been stopped.');
    };

    /**
     * Unregister a back-end function that was set with registerCallback.
     *
     * @param {String} url The page that was being listened for using its URL; do not include the
     *                     domain name and port number.
     * @param {Function} callback The function that was originally registered as the callback.
     * @return {Boolean} True is the function was unregistered, false otherwise.
     */
    const unregisterCallback = function (url, func) {
        url = correctURL(url);
        const keys = Object.keys(OP.callbacks);
        for (let i = 0; i < keys.length; i++) {
            if (keys[i] === url) {
                const callbacks = OP.callbacks[keys[i]];
                for (let c = 0; c < callbacks.length; c++) {
                    if (callbacks[c] === func) {
                        callbacks.splice(c, 1);
                        return true;
                    }
                }
                break;
            }
        }
        return false;
    };

    // Configure the new instance of NSS.
    initialize(options);

    // Public methods.
    return {
        message,
        registerCallback,
        reloadPages,
        reloadStyles,
        start,
        stop,
        unregisterCallback
    };

}

module.exports = NodeSimpleServer;
