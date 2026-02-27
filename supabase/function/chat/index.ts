import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader! } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages, conversationId } = await req.json();

    // Save user message to DB
    const lastUserMsg = messages[messages.length - 1];
    if (lastUserMsg?.role === "user") {
      await supabase.from("messages").insert({
        conversation_id: conversationId,
        user_id: user.id,
        content: lastUserMsg.content,
        sender_type: "user",
      });
    }

    // Check unresolved turn count for escalation
    const { data: recentMessages } = await supabase
      .from("messages")
      .select("sender_type, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(10);

    let unresolvedCount = 0;
    if (recentMessages) {
      for (const msg of recentMessages) {
        if (msg.sender_type === "user") unresolvedCount++;
        else break;
      }
    }

    const shouldEscalate = unresolvedCount >= 3;

    const systemPrompt = `You are a helpful banking assistant for a financial services company. You help customers with:
- Account inquiries (balances, transactions, statements)
- Transfers and payments
- Card management (lost/stolen, limits, PIN)
- Loan and mortgage questions
- General banking guidance

Be professional, concise, and empathetic. If you cannot resolve the issue, acknowledge it clearly.
${shouldEscalate ? "\n⚠️ IMPORTANT: The customer has had multiple unresolved turns. Acknowledge that you're escalating to a human agent and reassure them that help is on the way." : ""}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If escalation triggered, log it
    if (shouldEscalate) {
      await supabase.from("escalation_events").insert({
        conversation_id: conversationId,
        user_id: user.id,
        reason: `Unresolved after ${unresolvedCount} consecutive user messages`,
        unresolved_count: unresolvedCount,
      });
    }

    // We need to collect the full response for saving to DB
    // But also stream to client. We'll use a TransformStream to tee.
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    let fullContent = "";

    (async () => {
      const reader = response.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);

          // Parse for content to save
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") continue;
            try {
              const parsed = JSON.parse(jsonStr);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) fullContent += content;
            } catch {}
          }
        }
      } finally {
        // Save assistant message to DB
        if (fullContent) {
          await supabase.from("messages").insert({
            conversation_id: conversationId,
            user_id: user.id,
            content: fullContent,
            sender_type: "assistant",
          });
        }
        await writer.close();
      }
    })();

    // Add escalation flag in custom header
    return new Response(readable, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "X-Escalated": shouldEscalate ? "true" : "false",
      },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
