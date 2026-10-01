import { jsx as _jsx } from "react/jsx-runtime";
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './index.css';
const container = document.getElementById('root');
if (container === null) {
    throw new Error('SeqLens could not start: the #root element is missing from index.html.');
}
createRoot(container).render(_jsx(StrictMode, { children: _jsx(App, {}) }));
