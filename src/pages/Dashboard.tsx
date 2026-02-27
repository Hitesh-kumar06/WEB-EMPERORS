import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { motion } from "framer-motion";
import {
  Smartphone,
  ArrowLeftRight,
  Search,
  HelpCircle,
  ChevronRight,
  LogOut,
  Shield,
  User,
  AlertTriangle,
  KeyRound,
  MessageCircle,
  Clock,
  CreditCard,
  Phone,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const categories = [
  {
    id: "mobile_banking",
    label: "Mobile Banking App Issues",
    icon: Smartphone,
    color: "from-primary to-banking-blue-light",
    subIssues: [
      { id: "app_crash", label: "App Crash", icon: AlertTriangle },
      { id: "login_error", label: "Login Error", icon: KeyRound },
      { id: "otp_not_received", label: "OTP Not Received", icon: MessageCircle },
    ],
  },
  {
    id: "transaction",
    label: "Transaction Issues",
    icon: ArrowLeftRight,
    color: "from-banking-success to-emerald-400",
    subIssues: [
      { id: "failed_upi", label: "Failed UPI Payment", icon: CreditCard },
      { id: "debited_not_credited", label: "Money Debited but Not Credited", icon: Clock },
      { id: "pending_transaction", label: "Transaction Pending", icon: Clock },
    ],
  },
  {
    id: "track_reference",
    label: "Track My Reference Number",
    icon: Search,
    color: "from-banking-warning to-amber-400",
    subIssues: [
      { id: "track_ref", label: "Enter Reference Number to Track", icon: Search },
    ],
  },
  {
    id: "general",
    label: "General Banking Issues",
    icon: HelpCircle,
    color: "from-violet-500 to-purple-400",
    subIssues: [
      { id: "customer_id_verify", label: "Customer ID Verification", icon: User },
      { id: "mobile_update", label: "Mobile Number Update", icon: Phone },
      { id: "name_mismatch", label: "Account Holder Name Mismatch", icon: AlertTriangle },
      { id: "branch_details", label: "Branch Details", icon: MapPin },
    ],
  },
];

export default function Dashboard() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const handleSelectIssue = (categoryId: string, categoryLabel: string, subIssueId: string, subIssueLabel: string) => {
    navigate("/chat", {
      state: {
        issueType: categoryLabel,
        issueDetail: subIssueLabel,
        issueId: `${categoryId}/${subIssueId}`,
      },
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card shadow-banking">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl banking-gradient flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-display font-bold text-lg text-foreground">SecureBank Support</h1>
              <p className="text-xs text-muted-foreground">AI-Powered Technical Assistance</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:block text-right">
              <p className="text-sm font-medium text-foreground">{profile?.name || "User"}</p>
              <p className="text-xs text-muted-foreground">ID: {profile?.customer_id || "—"}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={signOut} title="Sign Out">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-10"
        >
          <h2 className="text-3xl font-display font-bold text-foreground mb-2">How can we help you?</h2>
          <p className="text-muted-foreground">Select your issue category to get started with AI-powered support.</p>
        </motion.div>

        <div className="grid gap-4 sm:grid-cols-2">
          {categories.map((cat, index) => {
            const isExpanded = expandedCategory === cat.id;
            return (
              <motion.div
                key={cat.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.08 }}
                className="group"
              >
                <button
                  onClick={() => setExpandedCategory(isExpanded ? null : cat.id)}
                  className={`w-full text-left rounded-xl border p-5 transition-all duration-300 ${
                    isExpanded
                      ? "border-primary bg-accent shadow-glow"
                      : "border-border bg-card hover:border-primary/40 hover:shadow-banking"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${cat.color} flex items-center justify-center shrink-0`}>
                      <cat.icon className="w-6 h-6 text-primary-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-display font-semibold text-foreground">{cat.label}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {cat.subIssues.length} issue type{cat.subIssues.length > 1 ? "s" : ""}
                      </p>
                    </div>
                    <ChevronRight
                      className={`w-5 h-5 text-muted-foreground transition-transform ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                    />
                  </div>
                </button>

                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="mt-2 ml-4 space-y-1.5"
                  >
                    {cat.subIssues.map((sub) => (
                      <button
                        key={sub.id}
                        onClick={() => handleSelectIssue(cat.id, cat.label, sub.id, sub.label)}
                        className="w-full flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-accent hover:border-primary/30 transition-all text-left group/sub"
                      >
                        <sub.icon className="w-4 h-4 text-muted-foreground group-hover/sub:text-primary transition-colors" />
                        <span className="text-sm text-foreground">{sub.label}</span>
                        <ArrowLeftRight className="w-3 h-3 ml-auto text-muted-foreground opacity-0 group-hover/sub:opacity-100 transition-opacity" />
                      </button>
                    ))}
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
