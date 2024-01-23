import Chokidar from 'chokidar';
import Fs from 'fs';
import Http from 'http';
import Os from 'os';
import Path from 'path';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';

import ContentTypes from '../handlers/js/content-types.js';
import HTTPStatus from '../handlers/js/http-status.js';
import Print from './print.js';

// eslint-disable-next-line no-underscore-dangle
const __filename = fileURLToPath(import.meta.url);
// eslint-disable-next-line no-underscore-dangle
const __dirname = Path.dirname(__filename);
const APP_ROOT = Path.join(__dirname, '../');

class NodeSimpleServer {

    #handlers = {};

    #OPS = {
        callbacks: [],
        contentType: 'text/html',
        dirListing: false,
        disableAutoRestart: false,
        hostAddress: '127.0.0.1',
        indexPage: 'index.html',
        liveReloading: true,
        port: 5000,
        root: Path.normalize(`${process.cwd()}${Path.sep}`),
        running: false
    };

    #reload = ['.asp', '.html', '.htm', '.php', '.php3'];

    #server = null;

    #socket = null;

    #sockets = {
        routes: {},
        map: {}
    };

    #VERSION = '4.2.0';

    #watching = [];

    /**
     * Instantiate a new instance of Node Simple Server.
     *
     * @param {object} options
     * @param {string} options.contentType The default Content-Type to report to the browser;
     *                                     defaults to text/html.
     * @param {boolean} options.dirListing If a directory is requested should the directory listing
     *                                     page be shown; default false.
     * @param {string} options.indexPage If a directory is requested consider this file to be the
     *                                   index page if it exits at that location; defaults to index.html
     * @param {number} options.port The port number the HTTP and WebSocket server should listen on
     *                              for requests; default 5000.
     * @param {string} options.root The absolute path to the directory that should be considered the
     *                              servers root directory.
     */
    constructor(options = {}) {
        if (options.contentType) {
            this.#OPS.contentType = options.contentType;
        }
        if ('dirListing' in options) {
            if (this.whatIs(options.dirListing) === 'boolean') {
                this.#OPS.dirListing = options.dirListing;
            }
        }
        if ('disableAutoRestart' in options) {
            if (this.whatIs(options.disableAutoRestart) === 'boolean') {
                this.#OPS.disableAutoRestart = options.disableAutoRestart;
            }
        }
        if (options.hostAddress) {
            this.#OPS.hostAddress = options.hostAddress;
        }
        if (options.index) {
            this.#OPS.index = options.index;
        }
        if ('liveReloading' in options) {
            if (this.whatIs(options.liveReloading) === 'boolean') {
                this.#OPS.liveReloading = options.liveReloading;
            }
        }
        if (options.port) {
            this.#OPS.port = options.port;
        }
        if (options.root) {
            this.#OPS.root = options.root;
            if (this.#OPS.root[this.#OPS.root.length - 1] !== Path.sep) {
                this.#OPS.root += Path.sep;
            }
        }

        this.#OPS.hostAddress = `${this.#OPS.hostAddress}:${this.#OPS.port}`;
        this.#loadHandlers();
    }

    /**
     * Register a backend function to call when a frontend page messages in via websocket.
     * This will allow you to have two way communications with a page as long as you registered
     * a function on the frontend to capture and respond to websocket messages as well.
     *
     * @param {string} pattern A RegExp object to check the page URL's against or a string
     *                         representing a regular expression to check the page URL's against.
     * @param {function} callback The function to call if this page (url) messages.
     * @return {boolean} True if the function was registered, false otherwise.
     */
    addWebsocketCallback(pattern, callback) {
        const regex = this.makeRegex(pattern);
        if (regex !== null && typeof callback === 'function') {
            this.#OPS.callbacks.push([regex, callback]);
            return true;
        }
        return false;
    }

    /**
     * Get an array of all the IP addresses you can reach this server at either from
     * the machine itself or on the LAN.
     *
     * @return {Array} An array of loop back ip addresses and LAN addresses to this server.
     */
    getAddresses(port) {
        const locals = this.#getLocalAddresses();
        const addresses = [
            `http://localhost:${port}`,
            `http://127.0.0.1:${port}`
        ];
        Object.keys(locals).forEach((key) => {
            addresses.push(`http://${locals[key]}:${port}`);
        });
        return addresses;
    }

    /**
     * Get the contents of a directory for displaying in the directory listing page.
     *
     * @param {string} location The directory to search.
     * @return {object} The HTML entries for all directories [directories] and files [files] found.
     */
    #getDirList(location) {
        // Get all directories and files at this location.
        const files = [];
        const dirs = [];
        Fs.readdirSync(location).forEach((item) => {
            if (Fs.lstatSync(Path.join(location, item)).isDirectory()) {
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
            fileHtml += `<li><a href="[b]/${file}">${file}</a></li>`;
        });
        // Add the go back link (parent directory) for nested directories.
        if (location.replace(this.#OPS.root, '').length > 0) {
            dirHtml += '<li><a href="[b]/../">../</a></li>';
        }
        // Replace directories in the directory listing template.
        dirs.forEach((dir) => {
            dirHtml += `<li><a href="[b]/${dir}">${dir}</a></li>`;
        });
        return {
            directories: dirHtml,
            files: fileHtml
        };
    }

    /**
     * Attempt to locate the default index page for the specified directory.
     *
     * @param {string} location The absolute path to a dir the user is trying to
     *                          access on the frontend.
     * @return {string} The correct path to this directories default index or an empty path if
     *                  none was found.
     */
    #getIndexForLocation(location) {
        let index = '';
        for (let i = 0; i < this.#reload.length; i++) {
            const tmpIndex = `index${this.#reload[i]}`;
            if (Fs.existsSync(Path.normalize(Path.join(this.#OPS.root, location, tmpIndex)))) {
                index = tmpIndex;
                break;
            }
        }
        return index;
    }

    /**
     * Convert a timestamp or date into a browser compliant header date.
     *
     * @param {string} date Any timestamp string; usually the last modified date
     *                      of a file.
     * @return {string} The data converted to the format browsers expect to see
     *                  in the content headers.
     */
    getLastModified(date) {
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
    }

    /**
     * Get all IP addresses that are considered external on this machine; the server will
     * attempt to listen to the requested port on these addresses as well, allowing you to
     * view the site from other devices on the same network.
     *
     * {@link https://github.com/nisaacson/interface-addresses | Original Source}.
     *
     * @author Noah Isaacson
     * @return {object} An object of interface names [key] and their IPv4 IP addresses [value].
     */
    #getLocalAddresses() {
        const addresses = {};
        const interfaces = Os.networkInterfaces();
        Object.keys(interfaces).filter((key) => {
            const items = interfaces[key];
            return items.forEach((item) => {
                const { family } = item;
                if (family !== 'IPv4') {
                    return false;
                }
                const { internal } = item;
                if (internal) {
                    return false;
                }
                const { address } = item;
                addresses[key] = address;
                return true;
            });
        });
        return addresses;
    }

    /**
     * Create the HTTP headers object for the specified file if any.
     *
     * @param {object} settings Additional settings to set on the header object.
     * @param {string} settings.charset The charset to use for this content; defaults to utf-8.
     * @param {string} settings.contentType The content type of this request; defaults to this.#OPS.contentType.
     * @param {string} settings.file The systems absolute path to the file being requested by the server.
     * @param {string} settings.location The location (URL) to redirect to; must set for all 302 responses.
     * @return {object} The HTTP header object.
     */
    #getHeaders(settings = {}) {
        // Create the header object and set the Content-Type.
        const headers = {};
        const contentType = settings?.contentType || this.#OPS.contentType;
        const charset = settings?.charset || 'UTF-8';
        headers['Content-Type'] = `${contentType}; charset=${charset}`;
        // Standard headers that should always be set for NSS.
        let mtime = new Date().toUTCString();
        if (settings?.file) {
            mtime = Fs.statSync(settings.file).mtime;
        }
        const nssHeaders = {
            'Cache-Control': 'public, max-age=0',
            'Last-Modified': this.getLastModified(mtime),
            // eslint-disable-next-line quote-props
            'Vary': 'Origin',
            'X-Powered-By': `Node Simple Server (NSS) ${this.#VERSION}`
        };
        // If this is a redirect what is the proper location?
        if (settings?.location) {
            headers.Location = settings.location;
        }
        // Combine the headers and return the header object.
        return Object.assign(headers, nssHeaders);
    }

    /**
     * Returns an array of watcher objects showing you which directories and files are
     * actively being watched for changes.
     *
     * @return {Array} An array of watcher objects; 1 object per call to watch().
     */
    getWatched() {
        const watched = [];
        this.#watching.forEach((watcher) => {
            watched.push(watcher.getWatched());
        });
        return watched;
    }

    /**
     * Loads all the handler files that we use to respond to various requests
     * like directory listing, page not found, access denied, and so on.
     */
    #loadHandlers() {
        // eslint-disable-next-line max-len, no-template-curly-in-string
        const internalError = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>500 Internal Server Error</title><style>body,html{margin:0;padding:0}body{padding:15px}</style></head><body><h1>500 Internal Server Error</h1><p>Could not locate source file.</p><hr><p><i>Node Simple Server (NSS) {{version}} Server <script type="text/javascript">document.write(`${document.location.protocol}//${document.location.hostname}`);</script> Port <script type="text/javascript">document.write(document.location.port)</script></i></p>{{liveReloading}}</body></html>';

        const dirListingSrc = Path.join(APP_ROOT, 'handlers', 'dir-listing.html');
        const forbiddenSrc = Path.join(APP_ROOT, 'handlers', 'forbidden.html');
        const notFoundSrc = Path.join(APP_ROOT, 'handlers', 'not-found.html');

        let liveReloadingSrc = Path.join(APP_ROOT, 'handlers', 'live-reloading.html');
        if (!this.#OPS.liveReloading) {
            liveReloadingSrc = Path.join(APP_ROOT, 'handlers', 'websocket-only.html');
        }

        let dirListingContent = '';
        try {
            dirListingContent = Fs.readFileSync(dirListingSrc, { encoding: 'utf-8', flag: 'r' });
        } catch (_) { dirListingContent = internalError; }

        let forbiddenContent = '';
        try {
            forbiddenContent = Fs.readFileSync(forbiddenSrc, { encoding: 'utf-8', flag: 'r' });
        } catch (_) { forbiddenContent = internalError; }

        let liveReloadingContent = '';
        try {
            liveReloadingContent = Fs.readFileSync(liveReloadingSrc, { encoding: 'utf-8', flag: 'r' });
        } catch (_) { liveReloadingContent = '<!-- 500 Internal Server Error -->'; }

        liveReloadingContent = liveReloadingContent.replace('{{HOST_ADDRESS}}', this.#OPS.hostAddress);

        let notFoundContent = '';
        try {
            notFoundContent = Fs.readFileSync(notFoundSrc, { encoding: 'utf-8', flag: 'r' });
        } catch (_) { notFoundContent = internalError; }

        dirListingContent = dirListingContent.replace('{{version}}', this.#VERSION);
        dirListingContent = dirListingContent.replace('{{live_reload}}', liveReloadingContent);
        forbiddenContent = forbiddenContent.replace('{{version}}', this.#VERSION);
        forbiddenContent = forbiddenContent.replace('{{live_reload}}', liveReloadingContent);
        notFoundContent = notFoundContent.replace('{{version}}', this.#VERSION);
        notFoundContent = notFoundContent.replace('{{live_reload}}', liveReloadingContent);

        this.#handlers = {
            dirListing: dirListingContent,
            forbidden: forbiddenContent,
            liveReloading: liveReloadingContent,
            notFound: notFoundContent
        };
    }

    /**
     * Converts a regular expression (regex) string into an actual RegExp object.
     *
     * @param {string} pattern A string of text or a regex expressed as a string; don't forget to
     *                         escape characters that should be interpreted literally.
     * @return {RegExp|null} A RegExp object if the string could be converted, null otherwise.
     */
    makeRegex(pattern) {
        try {
            if (/\[|\]|\(|\)|\{|\}|\*|\$|\^/.test(pattern)) {
                return new RegExp(pattern);
            }
            if (pattern[0] === '/' && pattern[pattern.length - 1] === '/') {
                // eslint-disable-next-line no-param-reassign
                pattern = pattern.substr(1, pattern.length - 2);
            }
            return new RegExp(`^${pattern}$`);
        } catch (e) {
            return null;
        }
    }

    /**
     * Message a frontend page via the WebSocket connection if the page is currently connected.
     *
     * @param {string} pattern A RegExp object to check the page URL's against, a string
     *                         representing a regular expression to check the page URL's against,
     *                         or a font-end pages ID.
     * @param {*} message The message you would like to send. Any standard datatype may be provided
     *                    because the messages is converted to the NSS standard of:
     *                    { data: message, type: typeof message }
     * @return {boolean} True if the page is connected and the message was sent, false otherwise.
     */
    message(pattern, message) {
        const original = pattern.toString();
        const regex = this.makeRegex(pattern);
        let result = false;
        // See if we can instantly message the specified socket.
        if (this.#sockets.map[`S${pattern}`]) {
            this.#sockets.map[`S${pattern}`].send(message);
            return true;
        }
        // Attempt to find the requested page and message it.
        const keys = Object.keys(this.#sockets.routes);
        for (let i = 0; i < keys.length; i++) {
            if (regex != null) {
                if (regex.test(keys[i])) {
                    this.#sockets.routes[keys[i]].forEach((socket) => {
                        socket.send(message);
                    });
                    result = true;
                }
            } else if (original === keys[i]) {
                this.#sockets.routes[keys[i]].forEach((socket) => {
                    socket.send(message);
                });
                result = true;
            }
        }
        return result;
    }

    /**
     * Send the reload message to all connected pages.
     */
    reloadAllPages() {
        // Send the reload message to all connections.
        const keys = Object.keys(this.#sockets.map);
        keys.forEach((key) => {
            this.#sockets.map[key].send('reload');
        });
    }

    /**
     * Reload a single page or single group of font-end pages matching a specified pattern.
     *
     * @param {RegExp|String} pattern A RegExp object to check the page URL's against, a string
     *                                representing a regular expression to check the page URL's
     *                                against, or a string representing the pages front-end ID.
     * @return {null} Used only as a short circuit.
     */
    reloadSinglePage(pattern) {
        const original = pattern.toString();
        if (this.whatIs(pattern) !== 'regexp') {
            // eslint-disable-next-line no-param-reassign
            pattern = this.makeRegex(pattern);
        }
        // See if the pattern is a page id first.
        if (this.#sockets.map[original]) {
            this.#sockets.map[original].send('reload');
            return;
        }
        // See if the pattern matches a specific URL and reload all those pages.
        const keys = Object.keys(this.#sockets.routes);
        if (pattern != null) {
            for (let i = 0; i < keys.length; i++) {
                if (pattern.test(keys[i])) {
                    this.#sockets.routes[keys[i]].forEach((socket) => {
                        socket.send('reload');
                    });
                    return;
                }
            }
        }
    }

    /**
     * Send the refreshCSS message to all connected pages; this reloads only the CSS
     * and not the whole page.
     */
    reloadAllStyles() {
        // Send the refreshCSS message to all connections.
        const keys = Object.keys(this.#sockets.map);
        keys.forEach((key) => {
            this.#sockets.map[key].send('refreshCSS');
        });
    }

    /**
     * Reload the stylesheets for a single page or single group of pages matching a
     * specified pattern.
     *
     * @param {RegExp|String} pattern A RegExp object to check the page URL's against, a string
     *                                representing a regular expression to check the page URL's
     *                                against, or a string representing the pages front-end ID.
     * @return {null} Used only as a short circuit.
     */
    reloadSingleStyles(pattern) {
        const original = pattern.toString();
        if (this.whatIs(pattern) !== 'regexp') {
            // eslint-disable-next-line no-param-reassign
            pattern = this.makeRegex(pattern) || original;
        }
        // See if the pattern is a page id first.
        if (this.#sockets.map[original]) {
            this.#sockets.map[original].send('refreshCSS');
            return;
        }
        // See if the pattern matches a specific URL and reload all those pages.
        const keys = Object.keys(this.#sockets.routes);
        if (pattern != null) {
            for (let i = 0; i < keys.length; i++) {
                if (pattern.test(keys[i])) {
                    this.#sockets.routes[keys[i]].forEach((socket) => {
                        socket.send('refreshCSS');
                    });
                    return;
                }
            }
        }
    }

    /**
     * Unregister a backend function that was set with addWebsocketCallback.
     *
     * @param {string} pattern The same regular expression (regex) object or string that was
     *                         used when the callback function was first registered.
     * @param {function} callback The function that was originally registered as the callback.
     * @return {boolean} True is the function was unregistered, false otherwise.
     */
    removeWebsocketCallback(pattern, callback) {
        // Make sure the pattern is not null.
        let oldRegex = this.makeRegex(pattern);
        if (!oldRegex) {
            return false;
        }
        // Convert the regex to a string otherwise comparing will never work.
        oldRegex = oldRegex.toString();
        // Remove the pattern and callback from the registered callbacks if they exits.
        for (let i = 0; i < this.#OPS.callbacks.length; i++) {
            const regex = this.#OPS.callbacks[i][0].toString();
            const func = this.#OPS.callbacks[i][1];
            if (regex === oldRegex && func === callback) {
                this.#OPS.callbacks.splice(i, 1);
                return true;
            }
        }
        return false;
    }

    /**
     * The server listener for NSS. All HTTP requests are handled here.
     *
     * @param {object} request The HTTP request object.
     * @param {object} resp The HTTP response object waiting for communication back.
     * @return {void} Used only as a short circuit.
     */
    #serverListener(request, resp) {

        let requestUrl = request.url.replace(this.#OPS.root, '').replace(/(\.{1,2}[\\/])/g, '');
        let systemPath = Path.normalize(Path.join(this.#OPS.root, requestUrl.split(/[?#]/)[0]));
        let filename = Path.basename(systemPath);
        let ext = Path.extname(filename);

        if (filename === 'websocket.ws') {
            /*
             * ERROR: This should never trigger! If it does that means the server has an issue.
             * We can try and send back a 100 to save the socket connection but we might be
             * toast, http.createServer is having issues on this machine/ network.
             */
            resp.writeHead(HTTPStatus.continue, this.#getHeaders({ contentType: 'text/plain' }));
            return;
        }

        if (requestUrl === '/favicon.ico' && filename === 'favicon.ico') {
            let iconPath = Path.join(this.#OPS.root, 'favicon.ico'); // Users favicon.
            // If the user does not have a favicon try to default to NSS's favicon.
            if (!Fs.existsSync(iconPath)) {
                iconPath = Path.normalize(`${APP_ROOT}/sources/favicon.ico`);
            }
            // If NSS's favicon is also missing don't use a favicon; hides the 404.
            if (!Fs.existsSync(iconPath)) {
                resp.writeHead(HTTPStatus.noContent, this.#getHeaders({ contentType: ContentTypes[''] }));
                resp.end();
                return;
            }
            // We found a valid file, use it as the sites favicon.
            const ico = Fs.readFileSync(iconPath, { encoding: 'binary', flag: 'r' });
            resp.writeHead(HTTPStatus.found, this.#getHeaders({
                contentType: ContentTypes['.ico'],
                file: iconPath
            }));
            resp.write(ico, 'binary');
            resp.end();
            return;
        }

        // Attempt to locate the index it is missing or we are at the root of a directory.
        if (requestUrl === '' || requestUrl === '/' || !ext) {
            // Determine the correct home page by checking the allowed extensions:
            const index = this.#getIndexForLocation(requestUrl);
            // No home page found:
            if (!index) {
                // Show the directory listing if it is allowed.
                this.#showDirListing(resp, systemPath);
                return;
            }
            // If we found an index make sure the requested path ends with a path separator.
            if (requestUrl[requestUrl.length - 1] !== '/') {
                requestUrl += '/';
                // This means the system path needs it added as well.
                systemPath += Path.sep;
            }
            // Home page was located, update variables and load it in a minute.
            requestUrl += index;
            systemPath += index;
            filename = index;
            ext = Path.extname(index);
        }

        // Did the user specifically request a dir?
        if (!ext) {
            if (requestUrl.slice(-1) === '/') {
                requestUrl = requestUrl.substring(0, requestUrl.length - 1);
            }
            if (systemPath.slice(-1) === Path.sep) {
                systemPath = systemPath.substring(0, systemPath.length - 1);
            }
            this.#showDirListing(resp, systemPath);
            return;
        }

        // Attempt to access the requested file.
        try {
            Fs.accessSync(systemPath, Fs.constants.R_OK);
        } catch (err) {
            if (err.message.includes('no such')) {
                this.#showNotFound(resp);
                return;
            }
            // If this forbidden is called it means there are file permission errors.
            this.#showForbidden(resp);
            return;
        }

        // Get the file.
        const file = Fs.readFileSync(systemPath, { encoding: 'binary' });

        // Output the file to the browser.
        resp.writeHead(HTTPStatus.ok, this.#getHeaders({
            contentType: ContentTypes[ext] || this.#OPS.contentType,
            file: systemPath
        }));

        // If needed inject NSS's WebSocket at the end of the page.
        if (this.#reload.includes(ext)) {
            let html = file.toString();
            const last = html.lastIndexOf('</body>');
            if (last && last > 0) {
                const start = html.substring(0, last);
                const end = html.substring(last);
                html = start + this.#handlers.liveReloading + end;
                resp.write(html, 'utf-8');
            } else {
                resp.write(file, 'binary');
            }
        } else {
            resp.write(file, 'binary');
        }
        resp.end();
    }

    /**
     * If enabled displays the directory listing page to the user.
     *
     * @param {ServerResponse} resp The response object for a request being made.
     * @param {string} systemPath The directory that the user is trying to view.
     * @return {void} Used only as a short circuit.
     */
    #showDirListing(resp, systemPath) {
        if (!Fs.existsSync(systemPath)) {
            this.#showNotFound(resp);
            return;
        }

        if (!this.#OPS.dirListing || !Fs.lstatSync(systemPath).isDirectory()) {
            this.#showForbidden(resp);
            return;
        }

        const { directories, files } = this.#getDirList(systemPath);
        let html = this.#handlers.dirListing;
        html = html.replace('{{files}}', files);
        html = html.replace('{{directories}}', directories);
        resp.writeHead(HTTPStatus.ok, this.#getHeaders({ contentType: 'text/html' }));
        resp.write(html, 'utf8');
        resp.end();
    }

    /**
     * Displays the 403 forbidden page to the user.
     *
     * @param {ServerResponse} resp The response object for a request being made.
     */
    #showForbidden(resp) {
        resp.writeHead(HTTPStatus.forbidden, this.#getHeaders({ contentType: 'text/html' }));
        resp.write(this.#handlers.forbidden);
        resp.end();
    }

    /**
     * Displays the 404 page not found to the user.
     *
     * @param {ServerResponse} resp The response object for a request being made.
     */
    #showNotFound(resp) {
        resp.writeHead(HTTPStatus.notFound, this.#getHeaders({ contentType: 'text/html' }));
        resp.write(this.#handlers.notFound);
        resp.end();
    }

    /**
     * The WebSocket listener for NSS. All WebSocket requests are handled here.
     *
     * @param {object} socket The WebSocket object for this connection.
     * @param {object} request The incoming initial connection.
     */
    #socketListener(socket, request) {
        // Strip the page ID and /ws tag off the url to get the actual url.
        let cleanURL = request.url.substr(1, request.url.indexOf('/ws?id=') - 1);
        if (!cleanURL) {
            cleanURL = this.#OPS.indexPage;
        }

        // Do not assuming this is a directory listing, check for an index first.
        if (!Path.extname(cleanURL)) {
            const index = this.#getIndexForLocation(cleanURL);
            if (index) {
                if (cleanURL[cleanURL.length - 1] !== '/') {
                    cleanURL += '/';
                }
                cleanURL += index;
            }
        }

        // Record the unique page ID directly on the socket object.
        let idStartIndex;
        if (request.url.indexOf('?id=') !== -1) {
            idStartIndex = request.url.indexOf('?id=');
        } else {
            idStartIndex = -1;
        }

        let pageId;
        if (idStartIndex !== -1) {
            pageId = request.url.substr(idStartIndex).replace('?id=', '');
        } else {
            pageId = 'unknown';
        }

        // eslint-disable-next-line no-param-reassign
        socket.nssUid = pageId;

        // Overwrite the default send method to NSS's standard.
        const originalSend = socket.send.bind(socket);
        // eslint-disable-next-line no-param-reassign
        socket.send = (message) => {
            originalSend(JSON.stringify({
                message,
                type: this.whatIs(message)
            }));
        };

        // Record new socket connections.
        if (this.#sockets.routes[cleanURL]) {
            this.#sockets.routes[cleanURL].push(socket); // This page has opened multiple times.
        } else {
            this.#sockets.routes[cleanURL] = [socket]; // First time we've seen this page.
        }
        this.#sockets.map[`S${pageId}`] = socket;

        // If auto restart is supposed to be disabled tell the page now.
        if (this.#OPS.disableAutoRestart && this.#OPS.disableAutoRestart === true) {
            socket.send('disableAutoRestart');
        }

        // Handle future incoming WebSocket messages from this page.
        socket.on('message', (message) => {
            // NSS messages have a standard format.
            let msgObj;
            try {
                msgObj = JSON.parse(message.toString());
                if (!('message' in msgObj) || !('type' in msgObj)) {
                    throw new Error('Bad format!');
                }
            } catch (e) {
                Print.warn('Invalid socket message received! Socket message must be in Node Simple Server\'s format.');
                return;
            }

            // If message is a ping send pong and stop.
            if (msgObj.type === 'string') {
                if (msgObj.message === 'ping') {
                    this.message(pageId, 'pong');
                    return;
                }
            }

            // Pull out specific route if there is one.
            let route = null;
            if ('route' in msgObj) {
                route = msgObj.route;
            }

            // See if the message belongs to a callback and send it there.
            for (let i = 0; i < this.#OPS.callbacks.length; i++) {
                const regex = this.#OPS.callbacks[i][0];
                const callback = this.#OPS.callbacks[i][1];
                // If the message has a route check that only.
                if (route) {
                    if (regex.test(route)) {
                        callback(msgObj, pageId);
                        return;
                    }
                } else if (regex.test(cleanURL)) {
                    // Default to the URL (pathname).
                    callback(msgObj, pageId);
                    return;
                }
            }

            // No one is listening for this message.
            Print.warn(`Unanswered WebSocket message from ${cleanURL}: ${message.toString()}`);
        });

        // When a connection closes remove it from CONNECTIONS.
        socket.on('close', () => {
            // Remove this page from our list of active routes.
            const connections = this.#sockets.routes[cleanURL];
            for (let i = 0; i < connections.length; i++) {
                if (connections[i].nssUid === pageId) {
                    connections.splice(i, 1);
                    delete this.#sockets.map[pageId];
                    break;
                }
            }
        });

        console.log(this.#OPS.callbacks);
    }

    /**
     * Attempt to start the HTTP server and WebSocket listener.
     *
     * @param {int|null} port Allows force overriding of port number; you should usually not use
     *                        this, it's meant to be used internally to NSS.
     * @param {function} [callback] Optional function to call when the server successfully starts
     *                              (true) or gives up on trying to start (false);
     * @return {void} Used only as a short circuit.
     */
    start(port, callback) {

        // Port is usually internal to NSS so check if a user placed the callback first.
        if (port && typeof port === 'function') {
            // eslint-disable-next-line no-param-reassign
            callback = port;
            // eslint-disable-next-line no-param-reassign
            port = null;
        }

        // Make sure we have a proper callback function or null the variable.
        if (callback && typeof callback !== 'function') {
            // eslint-disable-next-line no-param-reassign
            callback = null;
        }

        // Don't start an already running server.
        if (this.#OPS.running) {
            Print.warn('Server is already running.');
            // Notify the callback.
            if (callback) {
                callback(true);
            }
            return;
        }

        // Create the HTTP server.
        this.#server = Http.createServer(this.#serverListener.bind(this));
        // Capture connection upgrade requests so we don't break WebSocket connections.
        // eslint-disable-next-line no-unused-vars
        this.#server.on('upgrade', (request, socket) => {
            /*
             * Node's http server is capable of handling websocket but you have to manually
             * handle a lot of work like the handshakes. We use WebSocketServer to avoid
             * having to do all that extra work. See the following if you want to handle
             * websocket without the WebSocket module:
             * https://medium.com/hackernoon/implementing-a-websocket-server-with-node-js-d9b78ec5ffa8
             *
             * this.#server.upgrade will clash with this.#socket.connection by running first. Currently
             * this.#server.upgrade is not used but in case we do in the future ignore all websocket
             * requests so they get passed on to the this.#socket.connection listener.
             */
            if (request.headers.upgrade === 'websocket') {
                // eslint-disable-next-line no-useless-return
                return;
            }
        });
        // Capture server errors and respond as needed.
        this.#server.on('error', (error) => {
            // The port we tried to use is taken, increment and try to start again.
            if (error.code === 'EADDRINUSE') {
                if (port) {
                    // Stop trying new ports after 100 attempts.
                    if (this.#OPS.port - port > 100) {
                        // eslint-disable-next-line max-len
                        Print.error(`FATAL ERROR: Could not find an available port number in the range of ${this.#OPS.port}–${this.#OPS.port + 100}.`);
                        // Notify the callback.
                        if (callback) {
                            callback(false);
                        }
                        return;
                    }
                    this.start(port + 1, callback);
                } else {
                    this.start(this.#OPS.port + 1, callback);
                }
                return;
            }
            Print.error(`Server Error:\n${error}`);
        });

        // Attempt to start the server now.
        // eslint-disable-next-line no-param-reassign
        port = port || this.#OPS.port;
        this.#server.listen(port, () => {
            // Server started successfully without error.
            this.#OPS.running = true;

            // Start the WebSocket Server on the same port.
            this.#socket = new WebSocketServer({ server: this.#server });
            this.#socket.on('connection', this.#socketListener.bind(this));

            // Warn the user if we had to change port numbers.
            if (port && (port !== this.#OPS.port)) {
                Print.warn(`Port ${this.#OPS.port} was in use, switched to using ${port}.\n`);
            }

            // Record port in use.
            this.#OPS.portInUse = port;

            // Log the ip addresses being watched.
            Print.notice('Node Simple Server live @:');
            const addresses = this.getAddresses(port);
            addresses.forEach((address) => {
                Print.notice(`    ${address}`);
            });
            Print.log('');

            // Notify the callback.
            if (callback) {
                callback(true);
            }
        });
    }

    /**
     * Stop the HTTP server and WebSocket listener gracefully.
     *
     * @param {function} [callback] Optional function to call when the server successfully
     *                              stops (true).
     */
    stop(callback) {
        if (this.#OPS.running) {
            // If any back-end files are being watched for changes stop monitoring them.
            this.watchEnd();
            // Close all socket connections; these would force the server to stay up.
            const keys = Object.keys(this.#sockets);
            keys.forEach((key) => {
                this.#sockets.routes[key].forEach((socket) => {
                    socket.send('close');
                    socket.close();
                });
            });
            // Now gracefully close SERVER and SOCKET.
            this.#server.close();
            this.#socket.close();
            // Reset NSS.
            this.#server = null;
            this.#socket = null;
            this.#OPS.running = false;
            Print.notice('Server has been stopped.');
        }
        // Notify the callback.
        if (callback) {
            callback(true);
        }
    }

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
    unwatch(paths) {
        // Convert paths to array if it's not already.
        if (this.whatIs(paths) === 'string') {
            // eslint-disable-next-line no-param-reassign
            paths = [paths];
        }
        // Search all watchers and remove any paths that match.
        this.#watching.forEach((watcher) => {
            watcher.unwatch(paths);
        });
    }

    /**
     * Start watching a file, files, directory, or directories for changes and then callback to
     * functions that can/ will respond to these changes.
     *
     * @param {string|array} paths Files, directories, or glob patterns for tracking. Takes an
     *                             array of strings or just one string.
     * @param {object} options A special configuration object that includes chokidar options and NSS options.
     *                         There are to many options to list here, see NSS's README for more
     *                         information and remember `options.events` is required!
     * @return {boolean} True if it appears everything worked, false if something was missing or
     *                   an error was thrown.
     */
    watch(paths, options) {
        // Insure we have an options object.
        if (!options || !options.events) {
            return false;
        }
        /*
         * For security and a better user experience set the watchers current working
         * directory to NSS's root if the setting is missing.
         */
        if (!options.cwd) {
            // eslint-disable-next-line no-param-reassign
            options.cwd = this.#OPS.root;
        }
        // Convert paths to array if it's not already.
        if (this.whatIs(paths) === 'string') {
            // eslint-disable-next-line no-param-reassign
            paths = [paths];
        }
        try {
            // Start watching the path(s).
            const watcher = Chokidar.watch(paths, options);
            this.#watching.push(watcher);
            // Prepare to modify some of the standard Chokidar listeners.
            const alterAddUpdates = ['add', 'addDir', 'change'];
            const alterCatachAlls = ['all', 'raw'];
            const alterUnlinks = ['unlink', 'unlinkDir'];
            // Hookup requested listeners; they are case sensitive so type them right in your code!
            Object.keys(options.events).forEach((key) => {
                /**
                 * NON-STANDARD ALTERATIONS!
                 *
                 * Chokidar provides paths in the correct OS format but NSS will change
                 * all backslashes (\) into forward slashes (/).
                 */
                if (alterCatachAlls.includes(key)) {
                    watcher.on(key, (evt, path, statsOrDetails = {}) => {
                        // Capture the call and alter the path before passing it on.
                        const altPath = path.replace(/\\/g, '/');
                        // Since we're messing with the path already grab the extension for the user.
                        // eslint-disable-next-line no-param-reassign
                        statsOrDetails.ext = Path.extname(altPath).replace('.', '');
                        options.events[key](evt, altPath, statsOrDetails);
                    });
                } else if (alterAddUpdates.includes(key)) {
                    watcher.on(key, (path, statsOrDetails = {}) => {
                        // Capture the call and alter the path before passing it on.
                        const altPath = path.replace(/\\/g, '/');
                        // Since we're messing with the path already grab the extension for the user.
                        // eslint-disable-next-line no-param-reassign
                        statsOrDetails.ext = Path.extname(altPath).replace('.', '');
                        options.events[key](altPath, statsOrDetails);
                    });
                } else if (alterUnlinks.includes(key)) {
                    watcher.on(key, (path) => {
                        // Capture the call and alter the path before passing it on.
                        const altPath = path.replace(/\\/g, '/');
                        // Since we're messing with the path already grab the extension for the user.
                        const ext = Path.extname(altPath);
                        options.events[key](altPath, ext.replace('.', ''));
                    });
                } else {
                    watcher.on(key, options.events[key]);
                }
            });
        } catch (error) {
            Print.error(error);
            return false;
        }
        return true;
    }

    /**
     * Stop watching registered file, files, directory, or directories for changes.
     */
    watchEnd() {
        this.#watching.forEach((watcher) => {
            watcher.close();
        });
        this.#watching.splice(0, this.#watching.length);
    }

    /**
     * The fastest way to get the actual type of anything in JavaScript.
     *
     * {@link https://jsbench.me/ruks9jljcu/2 | See benchmarks}.
     *
     * @param {*} unknown Anything you wish to check the type of.
     * @return {string|undefined} The type in lowercase of the unknown value passed in or undefined.
     */
    whatIs(unknown) {
        try {
            return ({}).toString.call(unknown).match(/\s([^\]]+)/)[1].toLowerCase();
        } catch (e) { return undefined; }
    }

}

export default NodeSimpleServer;
