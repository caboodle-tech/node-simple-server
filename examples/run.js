import WebsiteDemo from './controllers/website.js';
import WebsocketDemo from './controllers/websocket.js';

let runDemo = 'website';

if (process.argv.length > 2) {
    runDemo = process.argv[2];
}

switch (runDemo) {
    case 'websocket':
        WebsocketDemo();
        break;
    case 'website':
    default:
        WebsiteDemo();
}
