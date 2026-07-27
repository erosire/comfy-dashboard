// React entry point — mounts the App component into the #root DOM element.
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { injectGlobalStyles } from './styles';

// Inject the dashboard's global stylesheet before mounting React.
injectGlobalStyles();

const root = ReactDOM.createRoot(document.getElementById('root')!);

root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
