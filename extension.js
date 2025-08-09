// vscode: The API for interacting with VS Code — lets you create commands, 
//views, notifications, etc:
const vscode = require('vscode');
//net: Node.js TCP sockets module — used here to open TCP client connections 
//to your C++ app:
const net = require('net');

//context is an object VS Code gives you to manage resources and clean up 
//when your extension is deactivated:
function activate(context) {
//panel: the Webview panel in VS Code where you will display your Tamagotchi 
//“live view” (the game’s graphics):
    let panel;
 //messageClient: TCP socket to send commands (e.g., color:red) to your C++ 
 //backend:
    let messageClient;
     
// The below code registers a new command (tamo.showView) that the user can run 
//(via command palette, keyboard shortcut, button, etc.). When run, it creates 
// a Webview panel and sets up TCP connections:
    let showViewCmd = vscode.commands.registerCommand('tamo.showView', () => {

// In 'panel' we create a new panel titled “Tamagotchi Live View” in the 
// first column:
        panel = vscode.window.createWebviewPanel(
            'tamagotchiView',
            'Tamagotchi Live View',
            vscode.ViewColumn.One,
//Enables scripts inside the panel (so the embedded HTML/JS can run):
            { enableScripts: true }
        );
// We then set the HTML content of the panel to what getWebviewContent() returns:
        panel.webview.html = getWebviewContent();


// Opens a TCP connection to your C++ app’s image server on localhost port 12000:
        const imageClient = new net.Socket();
        imageClient.connect(12000, '127.0.0.1', () => {
            console.log('Connected to image server');
        });
        
 // Listens for incoming data chunks (images) from the TCP socket.
// Buffers the chunks, converts to Base64 (so it can be shown as an image in HTML).
//Sends the frame as a message to the Webview panel and clears the chunks for 
// the next frame:

        let chunks = [];
        imageClient.on('data', (data) => {
            chunks.push(data);
            const base64 = Buffer.concat(chunks).toString('base64');
            panel.webview.postMessage({ type: 'frame', data: base64 });
            chunks = [];
        });

        imageClient.on('error', (err) => console.error('Image socket error:', err));

 //Opens a second TCP connection to the message server running in your C++ app.
 //This channel sends commands to control the Tamagotchi.
        messageClient = new net.Socket();
        messageClient.connect(11999, '127.0.0.1', () => {
            console.log('Connected to message server');
        });

        messageClient.on('error', (err) => {
            console.error('Message socket error:', err);
            vscode.window.showErrorMessage('Could not connect to Tamagotchi message server.');
        });
    });


//Registers a command tamo.sendMessage that prompts the user to input a text 
//command. It thens ends the command over the messageClient TCP socket to the C++
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
//backend. When it receives a frame message, it updates the <img> source with 
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

module.exports = { activate, deactivate };