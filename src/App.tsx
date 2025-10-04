import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
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

interface StreamChunk {
  type: "chunk" | "complete" | "error";
  content?: string;
  success?: boolean;
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
  const [streamingMode, setStreamingMode] = useState(true);
  const [currentStreamingMessage, setCurrentStreamingMessage] = useState("");
  const [systemStatus, setSystemStatus] = useState<SystemStatus>({
    pythonAvailable: false,
    checking: true,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const streamBufferRef = useRef<string>("");
  const isActiveStreamRef = useRef<boolean>(false);

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentStreamingMessage]);

  // Initialize event listener on mount
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const initListener = async () => {
      try {
        unlisten = await listen<StreamChunk>("stream-chunk", (event) => {
          const chunk = event.payload;

          // Only process if we have an active stream
          if (!isActiveStreamRef.current) {
            console.log("Ignoring chunk - no active stream");
            return;
          }

          console.log("Processing chunk:", chunk);

          switch (chunk.type) {
            case "chunk":
              if (chunk.content) {
                streamBufferRef.current += chunk.content;
                setCurrentStreamingMessage(streamBufferRef.current);
              }
              break;

            case "complete":
              // Move buffered content to messages
              if (streamBufferRef.current) {
                const finalMessage: ChatMessage = {
                  role: "assistant",
                  content: streamBufferRef.current,
                  timestamp: new Date(),
                };
                setMessages((prev) => [...prev, finalMessage]);
              }

              // Clean up streaming state
              streamBufferRef.current = "";
              setCurrentStreamingMessage("");
              isActiveStreamRef.current = false;
              setLoading(false);
              console.log("Stream completed");
              break;

            case "error":
              const errorMessage: ChatMessage = {
                role: "error",
                content: chunk.error || "Streaming error occurred",
                timestamp: new Date(),
              };
              setMessages((prev) => [...prev, errorMessage]);

              // Clean up streaming state
              streamBufferRef.current = "";
              setCurrentStreamingMessage("");
              isActiveStreamRef.current = false;
              setLoading(false);
              console.log("Stream error:", chunk.error);
              break;
          }
        });

        unlistenRef.current = unlisten;
        console.log("Stream listener initialized");
      } catch (error) {
        console.error("Failed to setup stream listener:", error);
      }
    };

    initListener();

    return () => {
      if (unlisten) {
        unlisten();
        console.log("Stream listener cleaned up");
      }
      isActiveStreamRef.current = false;
      streamBufferRef.current = "";
    };
  }, []);

  // Check system status
  useEffect(() => {
    checkSystemStatus();
  }, []);

  const checkSystemStatus = async () => {
    try {
      setSystemStatus({ pythonAvailable: false, checking: true });

      const pythonAvailable = await invoke<boolean>("check_python_available");
      let pythonInfo: string | undefined;

      if (pythonAvailable) {
        try {
          pythonInfo = await invoke<string>("get_python_info");
        } catch (error) {
          console.error("Failed to get Python info:", error);
        }
      }

      setSystemStatus({
        pythonAvailable,
        pythonInfo,
        checking: false,
      });

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

  const handleSend = useCallback(async () => {
    if (!message.trim() || loading) return;

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

    const currentMessage = message;
    setMessage("");
    setLoading(true);

    if (streamingMode) {
      try {
        // Initialize streaming state
        console.log("Starting new stream for:", currentMessage);
        streamBufferRef.current = "";
        setCurrentStreamingMessage("");
        isActiveStreamRef.current = true;

        // Start streaming
        await invoke("send_to_python_stream", {
          message: currentMessage.trim(),
        });

        console.log("Stream request sent");
      } catch (error) {
        console.error("Stream error:", error);

        const errorMessage: ChatMessage = {
          role: "error",
          content: `Streaming failed: ${error}`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);

        // Clean up
        streamBufferRef.current = "";
        setCurrentStreamingMessage("");
        isActiveStreamRef.current = false;
        setLoading(false);
      }
    } else {
      // Non-streaming mode
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
      }, 30000);

      try {
        const response = await Promise.race([
          invoke<ChatResponse>("send_to_python", {
            message: currentMessage.trim(),
          }),
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
      }
    }

    setTimeout(() => inputRef.current?.focus(), 100);
  }, [message, loading, streamingMode, systemStatus.pythonAvailable]);

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = () => {
    if (window.confirm("Are you sure you want to clear the chat history?")) {
      setMessages([]);
      setCurrentStreamingMessage("");
      streamBufferRef.current = "";
      isActiveStreamRef.current = false;
      setMessage("");
      inputRef.current?.focus();
    }
  };

  const toggleStreamingMode = () => {
    if (!loading && !isActiveStreamRef.current) {
      setStreamingMode(!streamingMode);
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
          {/* Streaming Mode Toggle */}
          <div className="streaming-toggle">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={streamingMode}
                onChange={toggleStreamingMode}
                disabled={loading || isActiveStreamRef.current}
              />
              <span className="toggle-slider"></span>
              <span className="toggle-text">
                {streamingMode ? "⚡ Streaming" : "📦 Batch"}
              </span>
            </label>
          </div>

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
        {messages.length === 0 &&
          !systemStatus.checking &&
          !currentStreamingMessage && (
            <div className="empty-state">
              <p className="text-lg">👋 Start a conversation!</p>
              <p className="text-sm">
                Type a message below to chat with your Python backend
              </p>
              <p
                className="text-xs"
                style={{ marginTop: "10px", opacity: 0.7 }}
              >
                Mode:{" "}
                {streamingMode
                  ? "⚡ Streaming (real-time)"
                  : "📦 Batch (wait for complete response)"}
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

        {/* Current streaming message */}
        {currentStreamingMessage && (
          <div className="message-wrapper assistant">
            <div className="message message-assistant">
              <p className="message-content">{currentStreamingMessage}</p>
              <span className="streaming-cursor">▋</span>
            </div>
          </div>
        )}

        {/* Loading state */}
        {loading && !currentStreamingMessage && (
          <div className="message-wrapper assistant">
            <div className="message message-assistant loading">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <span className="loading-text">
                {streamingMode ? "Starting stream..." : "Thinking..."}
              </span>
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
                  ? streamingMode
                    ? "Streaming response..."
                    : "Waiting for response..."
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
                  ? streamingMode
                    ? "Streaming..."
                    : "Waiting for response..."
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
