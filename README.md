# NSS: a Node based Simple Server

A small but effective node based server for development sites, customizable live reloading, and websocket support built-in. You should consider using NSS if:

:heavy_check_mark:&nbsp; You want to add live reloading to the development process of a static site.

:heavy_check_mark:&nbsp; You want easy two-way communication from the back-end and front-end of your development site with built-in WebSockets ready for use.

:heavy_check_mark:&nbsp; You want more fine grained control over the whole live reloading process.

:heavy_check_mark:&nbsp; You want to easily test your development site on multiple devices; must be on the same LAN.

:heavy_check_mark:&nbsp; You want to easily setup a LAN application for educational purposes or other development; must be on the same LAN, please consider security implications.

## Installation

### Manually:

Node Simple Server (NSS) can be manually incorporated into your development process/ application. Extract the `nss` folder from the [latest release](https://github.com/caboodle-tech/node-simple-server/releases/) and then `import` the server module into your code, similar to:

```javascript
import NodeSimpleServer from './nss.js';
```

### Locally:

You can install and use NSS locally in a project with:

```bash
# As a normal dependency:
npm install @caboodle-tech/node-simple-server

# or as a development dependency:
npm install @caboodle-tech/node-simple-server --save-dev
```

Depending on how you use and incorporate NSS into your project will determine the best dependency strategy to use.

### Globally:

You can install and use NSS globally with:

```bash
npm install --global @caboodle-tech/node-simple-server
```

## Usage

NSS is designed to be controlled and/or wrapped by another application. The bare minimum code needed to use NSS in your application is:

```javascript
/**
 * Import NSS. Here it is being imported from a manual install.
 * NOTE: Manual installs must include the handlers directory one directory higher than NSS.
 */
import NodeSimpleServer from './nss.js';
import path from 'path'

// This is needed for ES modules.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Determine what directory to watch for changes.
const websiteRoot = __dirname;

// Build a bare minimum server options object.
const serverOptions = {
    root: websiteRoot
};

// Get a new instance of NSS.
const Server = new NodeSimpleServer(serverOptions);

// Start the server.
Server.start();

// A bare minimum callback to handle most development changes.
function watcherCallback(event, path, extension) {
    if (extension === 'css') {
        Server.reloadAllStyles();
        return;
    }
    if (extension === 'js') {
        /**
         * NOTE: This is a heavy request to use if your site loads resources from
         * other sites such as images, databases, or API calls. Consider a better
         * approach in this cases such as throttling.
         */
        Server.reloadAllPages();
        return;
    }
    if (event === 'change') {
        Server.reloadSinglePage(path);
    }
}

// Build a bare minimum watcher options object.
const watcherOptions = {
    events: {
        all: watcherCallback, // Just send everything to a single function.
    },
};

// Watch the current directory for changes.
Server.watch(websiteRoot, watcherOptions);
```

The `options` object **required** by the `watch` method must include an `events` property with at least one watched event. The demo code above used `all` to capture any event. This object takes a lot of settings and is explained below in the **Watch Options** table.

NSS uses `process.cwd()` as the live servers root if omitted and is pre-configured with several additional default settings. You can change these by providing your own `options` object when instantiating the server. How this looks in code is shown below, the following table **Server Options** explains all available options.

```javascript
// Make your options object.
const options = {...};

// Get a new instance of NSS and pass in the options.
const Server = new NodeSimpleServer(options);
```

**Note:** If you set `options.root` to a different location than the current directory, you should usually provide the same path or a child path of this path, when you instantiate `Server.watch`.

### :bookmark: Server Options (Object)

#### **contentType** &nbsp;&nbsp;&nbsp;default: text/html

-   The default Content-Type to report to the browser if one can not be determined for a page.

#### **dirListing** &nbsp;&nbsp;&nbsp;default: false

-   If a directory is requested should the directory listing page be shown.

#### **indexPage** &nbsp;&nbsp;&nbsp;default: index.html

-   If a directory is requested consider this file to be the index page if it exits at that location.

#### **port** &nbsp;&nbsp;&nbsp;default: 5000

-   The port number the HTTP and WebSocket server should listen on for requests.

#### **root** &nbsp;&nbsp;&nbsp;default: process.cwd()

-   The absolute path to the directory that should be considered the servers root directory.

### :bookmark: Watch Options (Object)

#### **events**

-   Set to an object that can have any combination of these properties: `all`, `add`, `addDir`, `change`, `unlink`, `unlinkDir`, `ready`, `raw`, `error`. Any property set on `events` should point to a callback function that will handle that event.

#### **persistent** &nbsp;&nbsp;&nbsp;default: true

-   Indicates whether the process should continue to run as long as files are being watched.

#### **ignored**

-   Defines files/paths to be ignored. The whole relative or absolute path is tested, not just filename. ([anymatch](https://github.com/micromatch/anymatch)-compatible definition)

#### **ignoreInitial** &nbsp;&nbsp;&nbsp;default: false

-   If set to `true` will not fire `add` or `addDir` events when the files/directories are first being discovered.

#### **followSymlinks** &nbsp;&nbsp;&nbsp;default: true

-   When `false`, only the symlinks themselves will be watched for changes instead of following the link references and bubbling events through the link's path.

#### **cwd**

-   The base directory from which watch `paths` are to be derived. Paths emitted with events will be relative to this path and will use only forward slashes (/) on all operating systems.

#### **disableGlobbing** &nbsp;&nbsp;&nbsp;default: false

-   If set to true then the strings passed to .watch() and .unwatch() are treated as literal path names, even if they look like globs.

#### **usePolling** &nbsp;&nbsp;&nbsp;default: false

-   Whether to use fs.watchFile (backed by polling), or fs.watch. If polling leads to high CPU utilization, consider setting this to `false`.

#### **interval** &nbsp;&nbsp;&nbsp;default: 100

-   Interval of file system polling, in milliseconds.

#### **binaryInterval** &nbsp;&nbsp;&nbsp;default: 300

-   Interval of file system polling for binary files.

#### **alwaysStat** &nbsp;&nbsp;&nbsp;default: false

-   If relying upon the `fs.Stats` object that may get passed with `add`, `addDir`, and `change` events, set this to `true` to ensure it is provided even in cases where it wasn't already available from the underlying watch events.

#### **depth** &nbsp;&nbsp;&nbsp;default: undefined

-   If set, limits how many levels of subdirectories will be traversed when watching for changes.

#### **awaitWriteFinish** &nbsp;&nbsp;&nbsp;default: false

-   By default, the add event will fire when a file first appears on disk, before the entire file has been written.

#### **ignorePermissionErrors** &nbsp;&nbsp;&nbsp;default: false

-Indicates whether to watch files that don't have read permissions if possible. If watching fails due to `EPERM` or `EACCES` with this set to `true`, the errors will be suppressed silently.

#### **atomic** &nbsp;&nbsp;&nbsp;default: true

-   Automatically filters out artifacts that occur when using editors that use "atomic writes" instead of writing directly to the source file.

Most of the **Watch Object Options** are directly from [chokidar](https://github.com/paulmillr/chokidar) which is being used to handle the file monitoring. You may want to visit the [chokidar repo](https://github.com/paulmillr/chokidar) for more information. Please note that event paths are altered by NSS to only use forward slashes (/) on all operating systems.

### :bookmark: Server Methods

With your new instance of NSS you can call any of the following public methods:

#### **addWebsocketCallback(pattern^, callback)**

-   Register a function (`callback`) to receive messages from the front-end if the pages URL matches the `pattern`.

### **getAddresses**

- Returns an array of all the IP addresses you can reach this server at either from the machine itself or on the local area network (LAN).

#### **getWatched**

-   Returns an array of watcher objects showing you which directories and files are actively being watched for changes.

#### **message(pageId | pattern^, msg)**

-   Send a message (`msg`) via WebSocket to the page that matches the `pageId`, or send to a page or pages that match the `pattern`.

#### **reloadPages()**

-   Sends the reload signal to all active pages.

#### **reloadSinglePage(pattern^)**

-   Sends the reload signal to a single page or group of pages matching the `pattern`.

#### **reloadSingleStyles(pattern^)**

-   Sends the refreshCSS signal to a single page or group of pages matching the `pattern`.

#### **reloadStyles()**

-   Sends the refreshCSS signal to all active pages.

#### **removeWebsocketCallback(pattern^, callback)**

-   Unregister (stop messaging) a `callback` function that was initially registered with the `pattern`.

#### **start(\[callback\]) | start(\[port\], \[callback\])**

-   Starts the HTTP and WebSocket servers and notifies `callback` if present. `Port` is meant to be an internal option for NSS only but you may specify a port number for NSS to use if you have strict requirements in your environment. NOTE: This is a blocking process and will keep any application that ran it alive until stopped gracefully or forcefully terminated. If you do not want this behavior for any reason you will need to call this in its own process.

#### **stop(\[callback\])**

-   Gracefully closes all HTTP and WebSocket connections and turns off the servers, notifying `callback` if present.

#### **unwatch(paths^^)**

-   Stop watching directories or files (`paths`) for changes previously registered with `watch`.

#### **watch(paths^^, watchOptionsObject)**

-   Start watching a file, files, directory, or directories (`paths`) for changes and then callback to functions set in `watchOptionsObject` that will respond to these changes.

#### **watchEnd()**

-   Stop watching all registered file, files, directory, or directories for changes.

### :bookmark: Symbol Key

**^** `pattern` refers to either a `RegExp` object or a string of text that represents a regular expression without surrounding slashes (/) or modifiers (g, i, etc.). If you provide a string make sure to correctly escape literal characters. In some instances `pattern` can also be a string of text representing a page's unique ID. `pattern` does not recognize glob patterns!

**^^** `paths` refers either to a string or array of strings. Paths to files, directories to be watched recursively, or glob patterns. Globs must not contain windows separators (\\), because that's how they work by the standard — you'll need to replace them with forward slashes (/). For additional glob documentation, check out low-level library: [picomatch](https://github.com/micromatch/picomatch).

## Changelog

The [current changelog is here](./changelogs/v2.md). All [other changelogs are here](./changelogs).

## Contributions

NSS is an open source community supported project, if you would like to help please consider <a href="https://github.com/caboodle-tech/node-simple-server/issues" target="_blank">tackling an issue</a> or <a href="https://ko-fi.com/caboodletech" target="_blank">making a donation</a> to keep the project alive.
