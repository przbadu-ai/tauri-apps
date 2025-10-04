import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface ChatMessage {
  role: "user" | "assistant" | "error";
  content: string;
  timestamp?: Date;
}

interface ChatResponse {
  success: boolean;
  message?: string;
  error?: string;
}

interface SystemStatus {
  pythonAvailable: boolean;
  pythonInfo?: string;
  checking: boolean;
}

function App() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>({
    pythonAvailable: false,
    checking: true,
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Check system status on mount
  useEffect(() => {
    checkSystemStatus();
  }, []);

  const checkSystemStatus = async () => {
    try {
      setSystemStatus((prev) => ({ ...prev, checking: true }));

      // Check if Python is available
      const pythonAvailable = await invoke<boolean>("check_python_available");

      // Get Python info if available
      let pythonInfo: string | undefined;
      if (pythonAvailable) {
        try {
          pythonInfo = await invoke<string>("get_python_info");
        } catch (error) {
          console.error("Failed to get Python info:", error);
        }
      }

      // Debug: Check script path
      if (process.env.NODE_ENV === "development") {
        try {
          const scriptPath = await invoke<string>("get_script_path");
          console.log("Script path info:", scriptPath);
        } catch (error) {
          console.error("Failed to get script path:", error);
        }
      }

      setSystemStatus({
        pythonAvailable,
        pythonInfo,
        checking: false,
      });

      // Show warning if Python is not available
      if (!pythonAvailable) {
        setMessages([
          {
            role: "error",
            content:
              "⚠️ Python is not installed or not found in PATH. Please install Python 3.x to use the chat feature.",
            timestamp: new Date(),
          },
        ]);
      }
    } catch (error) {
      console.error("Failed to check system status:", error);
      setSystemStatus({
        pythonAvailable: false,
        checking: false,
      });
    }
  };

  async function handleSend() {
    if (!message.trim() || loading) return;

    // Check if Python is available
    if (!systemStatus.pythonAvailable) {
      setMessages((prev) => [
        ...prev,
        {
          role: "error",
          content:
            "Cannot send message: Python is not available. Please install Python 3.x and restart the application.",
          timestamp: new Date(),
        },
      ]);
      return;
    }

    // Add user message
    const userMessage: ChatMessage = {
      role: "user",
      content: message,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setMessage("");
    setLoading(true);

    // Set timeout for long-running requests
    const timeoutId = setTimeout(() => {
      if (loading) {
        setMessages((prev) => [
          ...prev,
          {
            role: "error",
            content:
              "Request is taking longer than expected. The Python script might be unresponsive.",
            timestamp: new Date(),
          },
        ]);
      }
    }, 30000); // 30 second timeout warning

    try {
      // Call tauri command with timeout
      const response = await Promise.race([
        invoke<ChatResponse>("send_to_python", { message: message.trim() }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Request timeout after 45 seconds")),
            45000,
          ),
        ),
      ]);

      clearTimeout(timeoutId);

      if (response.success && response.message) {
        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: response.message,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } else {
        const errorMessage: ChatMessage = {
          role: "error",
          content: response.error || "Unknown error occurred",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      }
    } catch (error) {
      clearTimeout(timeoutId);
      const errorMessage: ChatMessage = {
        role: "error",
        content: `Failed to communicate with Python: ${error}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
      // Refocus input after sending
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = () => {
    if (window.confirm("Are you sure you want to clear the chat history?")) {
      setMessages([]);
      setMessage("");
      inputRef.current?.focus();
    }
  };

  const formatTimestamp = (date?: Date) => {
    if (!date) return "";
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "numeric",
      hour12: true,
    }).format(date);
  };

  return (
    <main className="container">
      <div className="header">
        <h1></h1>
        <div className="header-actions">
          {/* System Status Indicator */}
          <div className="system-status">
            {systemStatus.checking ? (
              <span className="status-checking">⏳ Checking system...</span>
            ) : systemStatus.pythonAvailable ? (
              <span className="status-ok" title={systemStatus.pythonInfo}>
                ✅ Python Ready
              </span>
            ) : (
              <span className="status-error">❌ Python Not Found</span>
            )}
          </div>

          {/* Clear Chat Button */}
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="clear-button"
              title="Clear chat history"
            >
              🗑️ Clear
            </button>
          )}
        </div>
      </div>

      {/* Chat Messages Container */}
      <div className="messages-container">
        {/* Empty state */}
        {messages.length === 0 && !systemStatus.checking && (
          <div className="empty-state">
            <p className="text-lg">👋 Start a conversation!</p>
            <p className="text-sm">
              Type a message below to chat with your Python backend
            </p>
            {!systemStatus.pythonAvailable && (
              <div className="warning-box">
                <p>⚠️ Python is not detected on your system.</p>
                <p>
                  Please install Python 3.x from{" "}
                  <a
                    href="https://www.python.org/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    python.org
                  </a>
                </p>
              </div>
            )}
          </div>
        )}

        {/* Display all messages */}
        {messages.map((msg, index) => (
          <div key={index} className={`message-wrapper ${msg.role}`}>
            <div className={`message message-${msg.role}`}>
              {msg.role === "error" && <span className="error-icon">⚠️</span>}
              <p className="message-content">{msg.content}</p>
              {msg.timestamp && (
                <span className="message-time">
                  {formatTimestamp(msg.timestamp)}
                </span>
              )}
            </div>
          </div>
        ))}

        {/* Loading state */}
        {loading && (
          <div className="message-wrapper assistant">
            <div className="message message-assistant loading">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <span className="loading-text">Thinking...</span>
            </div>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <form
        className="input-form"
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <div className="input-wrapper">
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={message}
            onChange={(e) => setMessage(e.currentTarget.value)}
            onKeyPress={handleKeyPress}
            disabled={loading || !systemStatus.pythonAvailable}
            className="message-input"
            placeholder={
              !systemStatus.pythonAvailable
                ? "Python not available..."
                : loading
                  ? "Waiting for response..."
                  : "Type your message..."
            }
          />
          <button
            type="submit"
            disabled={
              loading || !message.trim() || !systemStatus.pythonAvailable
            }
            className="send-button"
            title={
              !systemStatus.pythonAvailable
                ? "Python not available"
                : loading
                  ? "Waiting for response..."
                  : "Send message"
            }
          >
            {loading ? "⏳" : "Send"}
          </button>
        </div>
      </form>
    </main>
  );
}

export default App;
