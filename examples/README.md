# Examples

You will find several example use cases of NSS in this directory. The `run.js` file is responsible for launching the various demos and has been preconfigured to be called by `npm`:

| command | purpose |
|---|---|
| npm run example | Runs the default NSS demo which is the same as running `npm run example:website` |
| num run example:website | Demo using NSS for website development. |
| num run example:websocket | Demo using the websocket features of NSS to communicate from a website to a server and vice-versa. |

The `controllers` directory contains the scripts that control (run) the actual demos. You should review these files to get an idea of how to best implement NSS for your use case.

Other directories like `www-website` and `www-websocket` hold the code for the live demo websites. You can start a demo and modify files in the demos directory to see the changes live.

**NOTE:** Please do not modify any of the example files if you plan to contribute to NSS's codebase! These examples are meant for everyone's benefit and the only changes that will be accepted to this directory are the additions of examples that benefit NSS users as a whole.