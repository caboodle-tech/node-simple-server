/* eslint-disable no-console */
/* eslint-disable func-names */
/* eslint-disable no-shadow */

const Chokidar = require('chokidar');
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
        callbacks: [],
        contentType: 'text/html',
        dirListing: false,
        indexPage: 'index.html',
        port: 5000,
        root: Path.normalize(`${process.cwd()}/`),
        running: false
    };
    const RELOAD = ['.html', '.htm'];
    const SEP = Path.sep;
    let SERVER = null;
    let SOCKET = null;
    const VERSION = '1.3.0'; // Update on releases.
    const WATCHING = [];

    /**
     * Get an array of all the IP addresses you can reach this server at either from
     * the machine itself or on the local area network (LAN).
     *
     * @return {Array} An array of loop back ip addresses and LAN addresses to this server.
     */
    const getAddresses = function (port) {
        const locals = getLocalAddresses();
        const addresses = [
            `http://localhost:${port}`,
            `http://127.0.0.1:${port}`
        ];
        Object.keys(locals).forEach((key) => {
            addresses.push(`http://${locals[key]}:${port}`);
        });
        return addresses;
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
     * @param {String} [date] A time string representing the last modification of this file.
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
    const getLocalAddresses = function () {
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
     * Returns an array of watcher objects showing you which directories and files are
     * actively being watched for changes.
     *
     * @return {Array} An array of watcher objects; 1 object per call to watch().
     */
    const getWatched = function () {
        const watched = [];
        WATCHING.forEach((watcher) => {
            watched.push(watcher.getWatched());
        });
        return watched;
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
     * Converts a regular expression (regex) string into an actual RegExp object.
     *
     * @param {String} pattern A string of text or a regex expressed as a string; don't forget to
     *                         escape characters that should be interpreted literally.
     * @return {RegExp|null} A RegExp object if the string could be converted, null otherwise.
     */
    const makeRegex = function (pattern) {
        try {
            if (/\[|\]|\(|\)|\{|\}|\*|\$|\^/.test(pattern)) {
                return new RegExp(pattern);
            }
            if (pattern[0] === '/' && pattern[pattern.length - 1] === '/') {
                pattern = pattern.substr(1, pattern.length - 2);
            }
            return new RegExp(`^${pattern}$`);
        } catch (e) {
            return null;
        }
    };

    /**
     * Message a font-end page via the WebSocket connection if the page is currently connected.
     *
     * @param {String} pattern A RegExp object to check the page URL's against, a string
     *                         representing a regular expression to check the page URL's against,
     *                         or a font-end pages ID.
     * @param {String|*} msg The message you would like to send, usually a stringified JSON object.
     * @return {Boolean} True if the page is connected and the message was sent, false otherwise.
     */
    const message = function (pattern, msg) {
        const original = pattern.toString();
        const regex = makeRegex(pattern);
        let result = false;
        // Attempt to find the requested page and message it.
        const keys = Object.keys(CONNECTIONS);
        for (let i = 0; i < keys.length; i++) {
            if (regex != null) {
                if (regex.test(keys[i])) {
                    CONNECTIONS[keys[i]].forEach((socket) => {
                        socket.send(msg);
                    });
                    result = true;
                }
            } else if (original === keys[i]) {
                CONNECTIONS[keys[i]].forEach((socket) => {
                    socket.send(msg);
                });
                result = true;
            }
        }
        return result;
    };

    /**
     * Register a back-end function to call when a front-end page messages in. This will
     * allow you to have two way communications with a page as long as you registered
     * a function on the front-end as well.
     *
     * @param {String} pattern A RegExp object to check the page URL's against or a string
     *                         representing a regular expression to check the page URL's against.
     * @param {Function} callback The function to call if this page (url) messages.
     * @return {Boolean} True is the function was registered, false otherwise.
     */
    const registerCallback = function (pattern, callback) {
        const regex = makeRegex(pattern);
        if (regex !== null && typeof callback === 'function') {
            OP.callbacks.push([regex, callback]);
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
     * Reload a single page or single group of font-end pages matching a specified pattern.
     *
     * @param {RegExp|String} pattern A RegExp object to check the page URL's against, a string
     *                                representing a regular expression to check the page URL's
     *                                against, or a string representing the pages front-end ID.
     * @return {null} Used only as a short circuit.
     */
    const reloadSinglePage = function (pattern) {
        const original = pattern.toString();
        if (whatIs(pattern) !== 'regexp') {
            pattern = makeRegex(pattern);
        }
        // See if the pattern matches a specific URL and reload all those pages.
        const keys = Object.keys(CONNECTIONS);
        if (pattern != null) {
            for (let i = 0; i < keys.length; i++) {
                if (pattern.test(keys[i])) {
                    CONNECTIONS[keys[i]].forEach((socket) => {
                        socket.send('reload');
                    });
                    return;
                }
            }
        }
        // See if the pattern was a particular page ID.
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            for (let s = 0; s < CONNECTIONS[key].length; s++) {
                const socket = CONNECTIONS[key][s];
                if (socket.nssUID === original) {
                    socket.send('reload');
                    return;
                }
            }
        }
    };

    /**
     * Send the refreshCSS message to all connected pages; this reloads only the CSS
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
     * Reload the stylesheets for a single page or single group of pages matching a
     * specified pattern.
     *
     * @param {RegExp|String} pattern A RegExp object to check the page URL's against, a string
     *                                representing a regular expression to check the page URL's
     *                                against, or a string representing the pages front-end ID.
     * @return {null} Used only as a short circuit.
     */
    const reloadSingleStyles = function (pattern) {
        const original = pattern.toString();
        if (whatIs(pattern) !== 'regexp') {
            pattern = makeRegex(pattern) || original;
        }
        // See if the pattern matches a specific URL and reload all those pages.
        const keys = Object.keys(CONNECTIONS);
        if (pattern != null) {
            for (let i = 0; i < keys.length; i++) {
                if (pattern.test(keys[i])) {
                    CONNECTIONS[keys[i]].forEach((socket) => {
                        socket.send('refreshCSS');
                    });
                    return;
                }
            }
        }
        // See if the pattern was a particular page ID.
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            for (let s = 0; s < CONNECTIONS[key].length; s++) {
                const socket = CONNECTIONS[key][s];
                if (socket.nssUID === original) {
                    socket.send('refreshCSS');
                    return;
                }
            }
        }
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
        if (FS.existsSync(safeURL) && FS.lstatSync(safeURL).isDirectory()) {
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

                // If needed inject NSS's WebSocket at the end of the page.
                if (RELOAD.includes(Path.extname(safeURL))) {
                    let html = file.toString();
                    const last = html.lastIndexOf('</body>');
                    if (last && last > 0) {
                        const start = html.substr(0, last);
                        const end = html.substr(last);
                        html = start + inject + end;
                        response.write(html, 'utf8');
                    } else {
                        response.write(file, 'binary');
                    }
                } else {
                    response.write(file, 'binary');
                }

                // Close initial connection.
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

        // Strip the page ID and /ws tag off the url to get the actual url.
        let cleanURL = request.url.substr(1, request.url.indexOf('/ws?id=') - 1);
        if (!cleanURL) {
            cleanURL = OP.indexPage;
        }

        // Record the unique page ID directly on the socket object.
        const pageID = request.url.substr(request.url.indexOf('?id=')).replace('?id=', '');
        socket.nssUID = pageID;

        // Record new socket connections.
        if (CONNECTIONS[cleanURL]) {
            CONNECTIONS[cleanURL].push(socket); // This page has opened multiple times.
        } else {
            CONNECTIONS[cleanURL] = [socket]; // Fist time we've seen this page.
        }

        // If auto restart is supposed to be disabled tell the page now.
        if (OP.disableAutoRestart && OP.disableAutoRestart === true) {
            socket.send('disableAutoRestart');
        }

        // Handle future incoming WebSocket messages from this page.
        socket.on('message', (message) => {
            // See if the message belongs to a callback and send it there.
            for (let i = 0; i < OP.callbacks.length; i++) {
                const regex = OP.callbacks[i][0];
                const callback = OP.callbacks[i][1];
                if (regex.test(cleanURL)) {
                    callback(message.toString(), pageID);
                    return;
                }
            }
            // No one is listening for this message.
            console.log(`Unanswered WebSocket message from ${cleanURL}: ${message.toString()}`);
        });

        // When a connection closes remove it from CONNECTIONS.
        socket.on('close', () => {
            // Remove this page from our list of active connections.
            const connections = CONNECTIONS[cleanURL];
            for (let i = 0; i < connections.length; i++) {
                if (connections[i].nssUID === pageID) {
                    connections.splice(i, 1);
                    break;
                }
            }
        });

    };

    /**
     * Attempt to start the HTTP server and WebSocket listener.
     *
     * @param {Int|null} port Allows force overriding of port number; you should usually not use
     *                        this, it's meant to be used internally to NSS.
     * @param {Function} [callback] Optional function to call when the server successfully starts
     *                              (true) or gives up on trying to start (false);
     * @return {null} Used only as a short circuit.
     */
    const start = function (port, callback) {

        // Post is usually internal to NSS so check if a user placed the callback first.
        if (port && typeof port === 'function') {
            callback = port;
            port = null;
        }

        // Make sure we have a proper callback function or null the variable.
        if (callback && typeof callback !== 'function') {
            callback = null;
        }

        // Don't start an already running server.
        if (OP.running) {
            console.log('Server is already running.');
            // Notify the callback.
            if (callback) {
                callback(true);
            }
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
                    // Stop trying new ports after 100 attempts.
                    if (OP.port - port > 100) {
                        console.log(`FATAL ERROR: Could not find an available port number in the range of ${OP.port}–${OP.port + 100}.`);
                        // Notify the callback.
                        if (callback) {
                            callback(false);
                        }
                        return;
                    }
                    start(port + 1, callback);
                } else {
                    start(OP.port + 1, callback);
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
            console.log('Node Simple Server live @:');
            const addresses = getAddresses(port);
            addresses.forEach((address) => {
                console.log(`    ${address}`);
            });
            console.log('');

            // Notify the callback.
            if (callback) {
                callback(true);
            }
        });
    };

    /**
     * Stop the HTTP server and WebSocket listener gracefully.
     *
     * @param {Function} [callback] Optional function to call when the server successfully
     *                              stops (true).
     */
    const stop = function (callback) {
        if (OP.running) {
            // If any back-end files are being watched for changes stop monitoring them.
            watchEnd();
            // Close all socket connections; these would force the server to stay up.
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
            OP.running = false;
            console.log('Server has been stopped.');
        }
        // Notify the callback.
        if (callback) {
            callback(true);
        }
    };

    /**
     * Stop watching directories or files for changes; previously registered with watch().
     *
     * Warning: If you watched a directory for changes watch() will auto watch all contents
     * of that directory recursively. You will need a different paths argument to truly
     * remove all files, it may be easier to call watchEnd() and then restart the watch()
     * you still need.
     *
     * @param {String|Array} paths Files, directories, or glob patterns for tracking. Takes an
     *                             array of strings or just one string.
     */
    const unwatch = function (paths) {
        // Convert paths to array if it's not already.
        if (whatIs(paths) === 'string') {
            paths = [paths];
        }
        // Search all watchers and remove any paths that match.
        WATCHING.forEach((watcher) => {
            watcher.unwatch(paths);
        });
    };

    /**
     * Unregister a back-end function that was set with registerCallback.
     *
     * @param {String} pattern The same regular expression (regex) object or string that was
     *                         used when the callback function was first registered.
     * @param {Function} callback The function that was originally registered as the callback.
     * @return {Boolean} True is the function was unregistered, false otherwise.
     */
    const unregisterCallback = function (pattern, callback) {
        // Make sure the pattern is not null.
        let oldRegex = makeRegex(pattern);
        if (!oldRegex) {
            return false;
        }
        // Convert the regex to a string otherwise comparing will never work.
        oldRegex = oldRegex.toString();
        // Remove the pattern and callback from the registered callbacks if they exits.
        for (let i = 0; i < OP.callbacks.length; i++) {
            const regex = OP.callbacks[i][0].toString();
            const func = OP.callbacks[i][1];
            if (regex === oldRegex && func === callback) {
                OP.callbacks.splice(i, 1);
                return true;
            }
        }
        return false;
    };

    /**
     * Start watching a file, files, directory, or directories for changes and then callback to
     * functions that can/ will respond to these changes.
     *
     * @param {String|Array} paths Files, directories, or glob patterns for tracking. Takes an
     *                             array of strings or just one string.
     * @param {Object} options A special configuration object that includes {@link https://github.com/paulmillr/chokidar|chokidar} options and NSS options.
     *                         See NSS's README for more information, options.events is required!
     * @return {Boolean} True if it appears everything worked, false if something was missing or
     *                   an error was thrown.
     */
    const watch = function (paths, options) {
        // Insure we have an options object.
        if (!options || !options.events) {
            return false;
        }
        /*
         * For security and a better user experience set the watchers current working
         * directory to NSS's root if the setting is missing.
         */
        if (!options.cwd) {
            options.cwd = OP.root;
        }
        // Convert paths to array if it's not already.
        if (whatIs(paths) === 'string') {
            paths = [paths];
        }
        try {
            // Start watching the path(s).
            const watcher = Chokidar.watch(paths, options);
            WATCHING.push(watcher);
            // Hookup requested listeners; they are case sensitive so type them right in your code!
            const safe = ['all', 'add', 'addDir', 'change', 'unlink', 'unlinkDir', 'ready', 'raw', 'error'];
            Object.keys(options.events).forEach((key) => {
                if (safe.includes(key)) {
                    watcher.on(key, options.events[key]);
                }
            });
        } catch (error) {
            console.log(error);
            return false;
        }
        return true;
    };

    /**
     * Stop watching registered file, files, directory, or directories for changes.
     */
    const watchEnd = function () {
        WATCHING.forEach((watcher) => {
            watcher.close();
        });
        WATCHING.splice(0, WATCHING.length);
    };

    /**
     * The fastest way to get the actual type of anything in JavaScript; {@link https://jsbench.me/ruks9jljcu/2| Benchmarks}.
     *
     * @param {*} unknown Anything you wish to check the type of.
     * @return {String|undefined} The type of the unknown value passed in or undefined.
     */
    const whatIs = function (unknown) {
        try {
            return ({}).toString.call(unknown).match(/\s([^\]]+)/)[1].toLowerCase();
        } catch (e) { return undefined; }
    };

    // Configure the new instance of NSS.
    initialize(options);

    // Public methods.
    return {
        getAddresses,
        getWatched,
        message,
        registerCallback,
        reloadPages,
        reloadSinglePage,
        reloadSingleStyles,
        reloadStyles,
        start,
        stop,
        unregisterCallback,
        unwatch,
        watch,
        watchEnd
    };

}

module.exports = NodeSimpleServer;
