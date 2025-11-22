import * as vscode from 'vscode';
export function openTestPage() {
    const testPage = vscode.window.createWebviewPanel(
        'testPage',
        'Test Page',
        vscode.ViewColumn.One,
        {
        }
    );

    testPage.webview.html = `
<!DOCTYPE html>
<html>
<head>
    <title>SIMPLE TEST</title>
</head>
<body>
    <h1>SUCCESS! HELLO WORLD!</h1>
</body>
</html>
`;
}    