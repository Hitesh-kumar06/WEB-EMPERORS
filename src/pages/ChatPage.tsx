import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import {
  Shield,
  Send,
  ArrowLeft,
  AlertTriangle,
  MessageSquare,
  Plus,
  Loader2,
  User,
  Bot,
  Clock,
} from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatRecord {
  id: string;
  issue_type: string;
  issue_detail: string | null;
  messages: Message[];
  resolved: boolean;
  escalated: boolean;
  created_at: string;
}

export default function ChatPage() {
  const { user, profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as {
    issueType?: string;
    issueDetail?: string;
    issueId?: string;
    chatId?: string;
  } | null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [chatId, setChatId] = useState<string | null>(state?.chatId || null);
  const [chatHistory, setChatHistory] = useState<ChatRecord[]>([]);
  const [escalated, setEscalated] = useState(false);
  const [userAttempts, setUserAttempts] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const issueType = state?.issueType || "General";
  const issueDetail = state?.issueDetail || "";

  // Fetch chat history
  useEffect(() => {
    if (!user) return;
    supabase
      .from("chats")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setChatHistory(data.map(c => ({
          ...c,
          messages: (c.messages as unknown as Message[]) || [],
        })) as ChatRecord[]);
      });
  }, [user, chatId]);

  // Load existing chat
  useEffect(() => {
    if (chatId && user) {
      supabase
        .from("chats")
        .select("*")
        .eq("id", chatId)
        .eq("user_id", user.id)
        .single()
        .then(({ data }) => {
          if (data) {
            setMessages((data.messages as unknown as Message[]) || []);
            setEscalated(data.escalated);
          }
        });
    }
  }, [chatId, user]);

  // Scroll to bottom
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const createChat = async (): Promise<string | null> => {
    if (!user) return null;
    const { data, error } = await supabase
      .from("chats")
      .insert({
        user_id: user.id,
        issue_type: issueType,
        issue_detail: issueDetail,
        messages: [],
      })
      .select("id")
      .single();
    if (error) {
      toast.error("Failed to create chat session");
      return null;
    }
    setChatId(data.id);
    return data.id;
  };

  const saveMessages = async (id: string, msgs: Message[], isEscalated: boolean) => {
    await supabase
      .from("chats")
      .update({
        messages: JSON.parse(JSON.stringify(msgs)),
        escalated: isEscalated,
        resolved: false,
      })
      .eq("id", id);
  };

  const createEscalationTicket = async () => {
    if (!user || !chatId) return;
    await supabase.from("tickets").insert({
      user_id: user.id,
      chat_id: chatId,
      issue_type: `${issueType} - ${issueDetail}`,
      summary: `Unresolved after multiple attempts. Last messages: ${messages.slice(-2).map(m => m.content).join(" | ")}`,
      priority: "high",
      status: "open",
    });
  };

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;
    const userMsg: Message = { role: "user", content: input.trim() };
    setInput("");

    let currentChatId = chatId;
    if (!currentChatId) {
      currentChatId = await createChat();
      if (!currentChatId) return;
    }

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setIsLoading(true);

    const newAttempts = userAttempts + 1;
    setUserAttempts(newAttempts);

    let assistantContent = "";
    const upsertAssistant = (chunk: string) => {
      assistantContent += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantContent } : m));
        }
        return [...prev, { role: "assistant", content: assistantContent }];
      });
    };

    try {
      const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/banking-chat`;
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: updatedMessages,
          issueType,
          issueDetail,
          customerName: profile?.name || "Customer",
          attempts: newAttempts,
        }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || `Request failed (${resp.status})`);
      }

      if (!resp.body) throw new Error("No response body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") { streamDone = true; break; }
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) upsertAssistant(content);
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      // Check for escalation
      const finalMessages = [...updatedMessages, { role: "assistant" as const, content: assistantContent }];
      let shouldEscalate = false;
      if (newAttempts >= 3 && !escalated) {
        shouldEscalate = true;
        setEscalated(true);
        await createEscalationTicket();
        toast.warning("This issue has been escalated to a human support agent.");
      }

      await saveMessages(currentChatId, finalMessages, shouldEscalate || escalated);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Unknown error";
      toast.error(errMsg);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, chatId, messages, userAttempts, escalated, issueType, issueDetail, profile, user]);

  const loadChat = (chat: ChatRecord) => {
    setChatId(chat.id);
    setMessages(chat.messages);
    setEscalated(chat.escalated);
    setUserAttempts(0);
    setSidebarOpen(false);
  };

  const startNewChat = () => {
    navigate("/dashboard");
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0 fixed lg:relative z-30 w-72 h-full border-r border-border bg-card transition-transform duration-300 flex flex-col`}
      >
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg banking-gradient flex items-center justify-center">
              <Shield className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-display font-bold text-foreground text-sm">SecureBank</span>
          </div>
          <Button onClick={startNewChat} variant="outline" className="w-full gap-2 text-sm">
            <Plus className="w-4 h-4" /> New Support Chat
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <p className="text-xs text-muted-foreground px-2 py-1 font-medium uppercase tracking-wider">
            Chat History
          </p>
          {chatHistory.map((chat) => (
            <button
              key={chat.id}
              onClick={() => loadChat(chat)}
              className={`w-full text-left p-3 rounded-lg text-sm transition-colors ${
                chatId === chat.id ? "bg-accent border border-primary/20" : "hover:bg-secondary"
              }`}
            >
              <div className="flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="truncate text-foreground font-medium">{chat.issue_type}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                {new Date(chat.created_at).toLocaleDateString()}
                {chat.escalated && (
                  <span className="text-destructive font-medium ml-auto">Escalated</span>
                )}
              </div>
            </button>
          ))}
          {chatHistory.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">No chat history yet</p>
          )}
        </div>

        {/* Profile */}
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center">
              <User className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">{profile?.name || "User"}</p>
              <p className="text-xs text-muted-foreground truncate">{profile?.customer_id || "—"}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Sidebar overlay on mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-foreground/20 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat Header */}
        <div className="h-14 border-b border-border bg-card flex items-center px-4 gap-3 shrink-0">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden text-muted-foreground">
            <MessageSquare className="w-5 h-5" />
          </button>
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")} className="gap-1.5 text-muted-foreground">
            <ArrowLeft className="w-4 h-4" /> Dashboard
          </Button>
          <div className="flex-1 text-center">
            <p className="text-sm font-semibold text-foreground">{issueType}</p>
            {issueDetail && <p className="text-xs text-muted-foreground">{issueDetail}</p>}
          </div>
          <div className="w-20" />
        </div>

        {/* Escalation Banner */}
        <AnimatePresence>
          {escalated && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="bg-destructive/10 border-b border-destructive/20 px-4 py-3 flex items-center gap-3"
            >
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
              <p className="text-sm text-destructive font-medium">
                This issue has been escalated. A human agent will follow up within 24 hours.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-2xl banking-gradient flex items-center justify-center mb-4 animate-pulse-glow">
                <Bot className="w-8 h-8 text-primary-foreground" />
              </div>
              <h3 className="font-display font-bold text-foreground text-lg mb-1">AI Banking Support</h3>
              <p className="text-muted-foreground text-sm max-w-md">
                Describe your issue and I'll help diagnose and resolve it step by step.
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="w-8 h-8 rounded-lg banking-gradient flex items-center justify-center shrink-0 mt-1">
                  <Bot className="w-4 h-4 text-primary-foreground" />
                </div>
              )}
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "banking-gradient text-primary-foreground rounded-br-md"
                    : "bg-card border border-border text-card-foreground rounded-bl-md"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  msg.content
                )}
              </div>
              {msg.role === "user" && (
                <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center shrink-0 mt-1">
                  <User className="w-4 h-4 text-muted-foreground" />
                </div>
              )}
            </motion.div>
          ))}

          {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg banking-gradient flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-primary-foreground" />
              </div>
              <div className="bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-border bg-card p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
            className="flex gap-3 max-w-3xl mx-auto"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Describe your issue..."
              className="flex-1"
              disabled={isLoading}
            />
            <Button type="submit" disabled={isLoading || !input.trim()} className="banking-gradient gap-2">
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
