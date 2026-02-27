import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are an intelligent banking technical support assistant working for SecureBank.

Your role:
- Diagnose banking technical issues step-by-step
- Ask clarifying questions before giving final solutions
- Provide instructions in simple, clear language
- Never ask for passwords, PINs, CVVs, or sensitive financial credentials
- If the issue remains unresolved after multiple attempts, recommend escalation to a human support agent
- Be empathetic and professional at all times
- Use numbered steps when providing instructions
- When diagnosing, consider common root causes first

Important guidelines:
- For UPI issues: check transaction status, suggest waiting period, recommend contacting bank
- For app crashes: suggest clearing cache, updating app, checking device compatibility
- For login errors: suggest password reset, checking internet connection, clearing app data
- For OTP issues: suggest checking network, waiting, trying alternative methods
- Always acknowledge the customer's frustration and assure them you'll help resolve the issue`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, issueType, issueDetail, customerName, attempts } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const contextMessage = `Customer: ${customerName}. Issue Category: ${issueType}. Specific Issue: ${issueDetail}. Attempt #${attempts}.${
      attempts >= 3
        ? " The customer has made multiple attempts. If the issue is still unresolved, recommend escalation to a human agent."
        : ""
    }`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "system", content: contextMessage },
            ...messages,
          ],
          stream: true,
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Too many requests. Please wait a moment and try again." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI service temporarily unavailable. Please try again later." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(
        JSON.stringify({ error: "AI service error. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("banking-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
