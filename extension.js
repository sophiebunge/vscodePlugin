// vscode: The API for interacting with VS Code — lets you create commands, 
//views, notifications, etc:
const vscode = require('vscode');
//net: Node.js TCP sockets module — used here to open TCP client connections 
//to your C++ app:
const net = require('net');
// this to run your C++ app before starting the extension
const cp = require('child_process'); 
const path = require('path'); // for constructing paths properly

//context is an object VS Code gives you to manage resources and clean up 
//when your extension is deactivated:
function activate(context) {
  //panel: the Webview panel in VS Code where you will display your Tamagotchi 
  //“live view” (the game’s graphics):
  let panel;
  //messageClient: TCP socket to send commands (e.g., color:red) to your C++ 
  //backend:
  let messageClient;

  // Flags to prevent rebuilding multiple times and to track if app is built
  let isBuilding = false;
  let hasBuilt = false;
   
  // The below code registers a new command (tamo.showView) that the user can run 
  //(via command palette, keyboard shortcut, button, etc.). When run, it creates 
  // a Webview panel and sets up TCP connections:
  let showViewCmd = vscode.commands.registerCommand('tamo.showView', () => {

    if (isBuilding) {
      vscode.window.showInformationMessage('Build already in progress...');
      return;
    }

    // If already built and panel exists, just reveal it
    if (hasBuilt && panel) {
      panel.reveal();
      return;
    }

    isBuilding = true;

    // Immediately open your webview panel so user can see it right away
    panel = vscode.window.createWebviewPanel(
      'tamagotchiView',
      'Tamagotchi Live View',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );
    panel.webview.html = getWebviewContent();

    // First build and run your oF app
    const ofAppPath = path.join(__dirname, '../ofxCodePlugin_CC2'); // adjust relative path
    const ofAppExecutable = path.join(ofAppPath, 'bin/ofxCodePlugin_CC2.app/Contents/MacOS/ofxCodePlugin_CC2');

    vscode.window.showInformationMessage('Building openFrameworks app...');

    // Use spawn instead of exec so it doesn't block
    const buildProcess = cp.spawn('make', ['Release'], { cwd: ofAppPath });

    buildProcess.stdout.on('data', data => console.log(data.toString()));
    buildProcess.stderr.on('data', data => console.error(data.toString()));

    buildProcess.on('close', code => {
      isBuilding = false;
      if (code !== 0) {
        vscode.window.showErrorMessage('Build failed! See console for details.');
        return;
      }
      vscode.window.showInformationMessage('Build succeeded, launching app...');
      
      hasBuilt = true;

      // Launch the oF app without blocking the extension
      const runProcess = cp.spawn(ofAppExecutable, [], { detached: true, stdio: 'ignore' });
      runProcess.unref(); // let it run independently

      // Connect to TCP servers once the app starts
      connectToImageServer(panel);
      connectToMessageServer();
    });
  });

  // Function to connect to image server and stream frames
  function connectToImageServer(panel) {
    // Opens a TCP connection to your C++ app’s image server on localhost port 12000:
    const imageClient = new net.Socket();
    let retries = 0;
    const maxRetries = 20;

    function tryConnect() {
      imageClient.connect(12000, '127.0.0.1', () => {
        console.log('Connected to image server');
      });
    }

    imageClient.on('connect', () => {
      let chunks = [];
      imageClient.on('data', (data) => {
        chunks.push(data);
        const base64 = Buffer.concat(chunks).toString('base64');
        panel.webview.postMessage({ type: 'frame', data: base64 });
        chunks = [];
      });
    });

    imageClient.on('error', (err) => {
      if (retries < maxRetries) {
        retries++;
        console.log(`Image server connection failed, retrying ${retries}/${maxRetries}...`);
        setTimeout(tryConnect, 1000);
      } else {
        console.error('Image socket error:', err);
        vscode.window.showErrorMessage('Could not connect to Tamagotchi image server after several retries.');
      }
    });

    tryConnect();
  }

  // Function to connect to message server for sending commands
  function connectToMessageServer() {
    messageClient = new net.Socket();
    let retries = 0;
    const maxRetries = 10;

    function tryConnect() {
      messageClient.connect(11999, '127.0.0.1', () => {
        console.log('Connected to message server');
      });
    }

    messageClient.on('error', (err) => {
      if (retries < maxRetries) {
        retries++;
        console.log(`Message server connection failed, retrying ${retries}/${maxRetries}...`);
        setTimeout(tryConnect, 1000);
      } else {
        console.error('Message socket error:', err);
        vscode.window.showErrorMessage('Could not connect to Tamagotchi message server after several retries.');
      }
    });

    tryConnect();
  }

  // Registers a command tamo.sendMessage that prompts the user to input a text 
  // command. It then sends the command over the messageClient TCP socket to the C++
  // backend and shows confirmation or error depending on connection status:
  let sendMessageCmd = vscode.commands.registerCommand('tamo.sendMessage', async () => {
    const message = await vscode.window.showInputBox({
      prompt: 'Enter a message to send to Tamagotchi',
      placeHolder: 'Example: color:red or ;dance'
    });

    if (message && messageClient) {
      messageClient.write(`${message}\n`);
      vscode.window.showInformationMessage(`Sent: ${message}`);
    } else {
      vscode.window.showErrorMessage('No active Tamagotchi connection. Run "Tamagotchi Live View" first.');
    }
  });

  // Ensures commands are properly cleaned up when the extension deactivates:
  context.subscriptions.push(showViewCmd, sendMessageCmd);
}

// Basic HTML with a black background. Contains an <img> element that will show 
// the latest image frame. Listens for message events from the extension’s 
// backend. When it receives a frame message, it updates the <img> source with 
// the base64 PNG data:
function getWebviewContent() {
  return `
    <!DOCTYPE html>
    <html>
    <body style="background:black; margin:0;">
      <img id="frame" style="width:100%; height:auto;">
      <script>
        const vscode = acquireVsCodeApi();
        window.addEventListener('message', event => {
          if (event.data.type === 'frame') {
            document.getElementById('frame').src = 'data:image/png;base64,' + event.data.data;
          }
        });
      </script>
    </body>
    </html>
  `;
}

// Placeholder for any cleanup code when the extension shuts down:
function deactivate() {}

module.exports = { activate, deactivate }
