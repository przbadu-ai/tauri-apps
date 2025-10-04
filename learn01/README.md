# Tauri Chat App

A desktop chat application built with Tauri, React, and Python that enables real-time conversation with an AI assistant.

## Features

- 💬 Real-time chat interface
- ⚡ Streaming responses for instant feedback
- 📦 Batch mode for complete responses
- 🐍 Python backend integration
- 🖥️ Cross-platform desktop app

## Prerequisites

- **Node.js** (v16 or higher)
- **Python** (v3.7 or higher)
- **Rust** (latest stable)

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd tauri-chat-app
```

2. Install dependencies:

```bash
npm install
```

3. Install Python dependencies:

```bash
pip install -r requirements.txt
```

## Development

Run the app in development mode:

```bash
npm run tauri dev
```

## Building

Create a production build:

```bash
npm run tauri build
```

## Usage

1. Launch the application
2. Type your message in the input field
3. Press Enter or click Send
4. Toggle between Streaming and Batch mode as needed
5. Click Clear to reset the conversation

## Tech Stack

- **Frontend**: React + TypeScript
- **Backend**: Tauri (Rust) + Python
- **Styling**: CSS

## License

MIT
