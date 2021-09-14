# NSS: a Node based Simple Server

Node Simple Server (NSS) is a small but effective node based server for development sites and self controlled live reloading. You should consider using NSS if:

:heavy_check_mark:&nbsp; You want to add live reloading to the development process of a static site.

:heavy_check_mark:&nbsp; You want easy two-way communication from the back-end and front-end of your development site; WebSockets managed for you.

:heavy_check_mark:&nbsp; You want more fine grained control over the whole live reloading process.

## Installation

### Manually:

NSS can be manually incorporated into your development process/ application. Extract the `nss` folder from the [latest release](https://github.com/caboodle-tech/nss/releases/) and then `require` the server module into your code, similar to:

```javascript
const NSS = require("./nss/server");
```

### Locally:

You can install and use NSS locally in a project with:

```bash
npm install @caboodle-tech/nss --save-dev
```

### Globally:

You can install and use NSS globally with:

```bash
npm install --global @caboodle-tech/nss
```

## Usage

NSS is designed to be controlled and/or wrapped by another application. The bare minimum code needed to use NSS in your application is:

```javascript
// Require NSS. Here it is required from a manual install.
const NSS = require("./nss/server");

// Get a new instance of NSS.
const Server = new NSS();

// Start the server.
NSS.start();
```

NSS uses the current working directory as the live servers root and is pre-configured with several additional default settings. You can change these by providing your own `options` object like so:

```javascript
// Make your options object.
const options = {...};

// Get a new instance of NSS and pass in the options.
const Server = new NSS(options);
```

### Options Object

| Property    | Description                                                                                       | Default       |
| ----------- | ------------------------------------------------------------------------------------------------- | ------------- |
| contentType | The default Content-Type to report to the browser if one can not be determined for a page.        | text/html     |
| dirListing  | If a directory is requested should the directory listing page be shown.                           | false         |
| indexPage   | If a directory is requested consider this file to be the index page if it exits at that location. | index.html    |
| port        | The port number the HTTP and WebSocket server should listen on for requests.                      | 5000          |
| root        | The absolute file system path to the directory that should be considered your sites root.         | process.cwd() |

### Methods

With your new instance of NSS you can call any of the following public methods:

#### **message(pattern^, msg)**

-   Send a message (`msg`) via WebSocket to the page or pages that match the `pattern`.

#### **registerCallback(pattern^, callback)**

-   Register a function (`callback`) to receive messages from the front-end if the pages URL matches the `pattern`.

#### **reloadPages()**

-   Sends the reload signal to all active pages.

#### **reloadSinglePage(pattern^)**

-   Sends the reload signal to a single page or group of pages matching the `pattern`.

#### **reloadSingleStyles(pattern^)**

-   Sends the refreshCSS signal to a single page or group of pages matching the `pattern`.

#### **reloadStyles()**

-   Sends the refreshCSS signal to all active pages.

#### **start()**

-   Starts the HTTP and WebSocket servers. NOTE: This is a blocking process and will keep any application that ran it alive until stopped gracefully or forcefully terminated. If you do not want this behavior for any reason you will need to call this in its own process.

#### **stop()**

-   Gracefully closes all HTTP and WebSocket connections and turns off the servers.

#### **unregisterCallback(pattern^ callback)**

-   Unregister (stop messaging) a function (`callback`) that was initially registered with the `pattern`.

**^** `pattern` refers to either a `RegExp` object or a `String` of text that represents a regular express without surrounding slashes (/) or modifiers (g, i, etc.). If you provide a `String` make sure to correctly escape literal characters. In some instances `pattern` can also be a `String` of text representing a page's unique ID.

## Contributions

NSS is an open source community supported project, if you would like to help please consider <a href="https://github.com/caboodle-tech/nss/issues" target="_blank">tackling an issue</a> or <a href="https://ko-fi.com/caboodletech" target="_blank">making a donation</a> to keep the project alive.
