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

  let typingTimer; // Status of user typing
  let isCurrentlyTyping = false; // Track if user is currently typing
  const IDLE_TIMEOUT = 3 * 60 * 10; // 3 minutes timeout

  // Create the webview view provider for the sidebar
  const provider = {
    resolveWebviewView(webviewView, context, _token) {
      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: []
      };

      webviewView.webview.html = getWebviewContent();
      
      // Store reference to webview for later use
      provider._view = webviewView;
      
      return webviewView;
    }
  };

  // Register the webview view provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('tamagotchi.liveView', provider)
  );
   
  // The below code registers a new command (tamo.showView) that the user can run 
  //(via command palette, keyboard shortcut, button, etc.). When run, it builds
  // and starts the openFrameworks app and connects to it:
  let showViewCmd = vscode.commands.registerCommand('tamo.showView', () => {

    if (isBuilding) {
      vscode.window.showInformationMessage('Build already in progress...');
      return;
    }

    // If already built, just show a message
    if (hasBuilt) {
      vscode.window.showInformationMessage('Tamagotchi app is already running! Check the sidebar.');
      return;
    }

    // Get the current webview (should exist in sidebar)
    const currentWebview = provider._view;
    if (!currentWebview) {
      // Try to focus the sidebar view to trigger its creation
      vscode.commands.executeCommand('tamagotchi.liveView.focus');
      
      // Wait a moment for the view to be created, then try again
      setTimeout(() => {
        if (provider._view) {
          // Restart the command now that the view exists
          vscode.commands.executeCommand('tamo.showView');
        } else {
          vscode.window.showErrorMessage('Please open the Tamagotchi sidebar (heart icon) first.');
        }
      }, 100);
      return;
    }

    isBuilding = true;

    // First build and run your oF app
    const ofAppPath = path.join(__dirname, '../ofxCodePlugin_CC2'); // adjust relative path
    const ofAppExecutable = path.join(ofAppPath, 'bin/ofxCodePlugin_CC2.app/Contents/MacOS/ofxCodePlugin_CC2');

    vscode.window.showInformationMessage('Building openFrameworks app...');
    console.log('Building at path:', ofAppPath);
    console.log('Executable path:', ofAppExecutable);

    // Send fake progress updates to webview
    let progress = 0;
    const progressInterval = setInterval(() => {
      if (currentWebview) {
        currentWebview.webview.postMessage({ type: 'progress', value: progress });
      }
      if (progress < 90) progress += 2; // increment until 90%
    }, 200);

    // Use spawn instead of exec so it doesn't block
    const buildProcess = cp.spawn('make', ['Release'], { cwd: ofAppPath });

    buildProcess.stdout.on('data', data => {
      console.log('BUILD OUTPUT:', data.toString());
    });
    buildProcess.stderr.on('data', data => {
      console.error('BUILD ERROR:', data.toString());
    });

    buildProcess.on('close', code => {
      clearInterval(progressInterval);
      isBuilding = false;
      if (code !== 0) {
        vscode.window.showErrorMessage('Build failed! See console for details.');
        return;
      }
      vscode.window.showInformationMessage('Build succeeded, launching app...');
      console.log('Launching app:', ofAppExecutable);
      
      hasBuilt = true;

      // Set progress to 100% before starting app
      if (currentWebview) currentWebview.webview.postMessage({ type: 'progress', value: 100 });

      // Launch the oF app without blocking the extension
      const runProcess = cp.spawn(ofAppExecutable, [], { detached: true, stdio: 'ignore' });
      runProcess.unref(); // let it run independently
      console.log('App launched, waiting 2 seconds before connecting...');

      // Connect to TCP servers once the app starts (with delay to let app initialize)
      setTimeout(() => {
        console.log('Attempting to connect to TCP servers...');
        connectToImageServer(currentWebview);
        connectToMessageServer();
      }, 2000); // Wait 2 seconds for the app to fully start
    });
  });

  // Function to connect to image server and stream frames
  function connectToImageServer(webview) {
    // Opens a TCP connection to your C++ app's image server on localhost port 12000:
    const imageClient = new net.Socket();
    let retries = 0;
    const maxRetries = 20;

    function tryConnect() {
      console.log('Trying to connect to image server on port 12000...');
      imageClient.connect(12000, '127.0.0.1', () => {
        console.log('Connected to image server');
        vscode.window.showInformationMessage('Connected to Tamagotchi image server');
      });
    }

    imageClient.on('connect', () => {
      console.log('Image client connected, listening for data...');
      let chunks = [];
      imageClient.on('data', (data) => {
        console.log('Received image data chunk, size:', data.length);
        chunks.push(data);
        
        // Check if we have a complete PNG by looking for PNG end marker
        const combined = Buffer.concat(chunks);
        const pngEnd = Buffer.from([0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]); // PNG IEND chunk
        
        if (combined.includes(pngEnd)) {
          // Find the end of the PNG
          const endIndex = combined.indexOf(pngEnd) + pngEnd.length;
          const completeFrame = combined.slice(0, endIndex);
          
          // Send complete frame to webview
          const base64 = completeFrame.toString('base64');
          webview.webview.postMessage({ type: 'frame', data: base64 });
          
          // Keep any remaining data for next frame
          const remaining = combined.slice(endIndex);
          chunks = remaining.length > 0 ? [remaining] : [];
        }
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

  // Add this event listener in your activate() function
  vscode.workspace.onDidChangeTextDocument((event) => {
    // Clear any existing timer
    clearTimeout(typingTimer);
    
  // If the user is currently typing, we set a timer to mark them as idle after few minutes
if (!isCurrentlyTyping) {
  isCurrentlyTyping = true;
  if (messageClient && messageClient.readyState === 'open') {
    const msg = 'User started typing - sent working status';
    messageClient.write(msg + '\n');  // actually send it over TCP
    console.log(msg); // still log it in VS Code console
  }
}

typingTimer = setTimeout(() => {
  isCurrentlyTyping = false;
  if (messageClient && messageClient.readyState === 'open') {
    const msg = 'User went idle - sent idle status';
    messageClient.write(msg + '\n');  // send over TCP
    console.log(msg); // log locally
  }
}, IDLE_TIMEOUT);
  });

  // Ensures commands are properly cleaned up when the extension deactivates:
  context.subscriptions.push(showViewCmd, sendMessageCmd);
}

// Basic HTML with loading screen and progress bar, replaced by live stream when ready:
function getWebviewContent() {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet" />
      <style>
        body {
          background: black;
          margin: 0;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          height: 100vh;
          font-family: 'Press Start 2P', monospace;
          /* Disable font smoothing for pixelated look */
          -webkit-font-smoothing: none;
          -moz-osx-font-smoothing: grayscale;
          image-rendering: pixelated;
          text-rendering: optimizeSpeed;
          letter-spacing: 1px;
          font-size: 8px; /* Smaller for sidebar */
          padding: 5px;
        }
        #loading {
          text-align: center;
          padding: 5px;
        }
        #bar {
          height: 100%;
          width: 0%;
          background: white;
        }
        #frame {
          width: 100%;
          height: auto;
          max-width: 100%;
          object-fit: contain;
        }
      </style>
    </head>
    <body>
      <div id="loading">
        <div>Loading... <span id="percent">0</span>%</div>
        <div style="width:150px; height:12px; border:1px solid white; margin-top:5px;">
          <div id="bar"></div>
        </div>
      </div>
      <img id="frame" style="display:none;">
      <script>
        const vscode = acquireVsCodeApi();
        window.addEventListener('message', event => {
          if (event.data.type === 'progress') {
            document.getElementById('percent').textContent = event.data.value;
            document.getElementById('bar').style.width = event.data.value + '%';
          }
          if (event.data.type === 'frame') {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('frame').style.display = 'block';
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
