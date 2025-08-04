const vscode = require('vscode');
const net = require('net');

function activate(context) {
    console.log('Tamagotchi Extension Active!');

    const disposable = vscode.commands.registerCommand('test04.helloWorld', function () {
        const panel = vscode.window.createWebviewPanel(
            'oFView',
            'oF Canvas',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        panel.webview.html = getWebviewContent();
    });

    context.subscriptions.push(disposable);

    // Typing listener
    const typingListener = vscode.workspace.onDidChangeTextDocument(event => {
        const client = new net.Socket();
        client.connect(11999, '127.0.0.1', function () {
            const colors = ['red', 'green', 'blue'];
            const color = colors[Math.floor(Math.random() * colors.length)];
            client.write(`color:${color}\n`);
            setTimeout(() => client.end(), 100);
        });

        client.on('error', function (err) {
            console.error('Socket error:', err.message);
        });
    });

    context.subscriptions.push(typingListener);
}

function getWebviewContent() {
    return `
    <!DOCTYPE html>
    <html>
    <body style="margin:0;overflow:hidden;">
        <iframe src="http://localhost:11999" width="100%" height="100%" frameborder="0"></iframe>
    </body>
    </html>`;
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
