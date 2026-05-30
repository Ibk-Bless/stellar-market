"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Tag, Loader2, ArrowUp, ArrowDown } from "lucide-react";
import axios from "axios";
import { z } from "zod";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { useWallet } from "@/context/WalletContext";
import { JOB_CATEGORIES, JOB_SKILLS, PAYMENT_TOKENS } from "@/constants/jobs";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

const milestoneSchema = z.object({
  title: z.string().min(3, "Milestone title is too short"),
  description: z.string().min(5, "Milestone description is too short"),
  amount: z.string().refine((value) => Number.parseFloat(value) > 0, {
    message: "Milestone amount must be greater than 0",
  }),
  deadline: z.string().refine((value) => {
    if (!value) return false;
    const dt = new Date(value);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return !Number.isNaN(dt.getTime()) && dt > today;
  }, "Milestone deadline must be in the future"),
});

const jobSchema = z.object({
  title: z.string().min(10, "Title must be at least 10 characters").max(100),
  description: z
    .string()
    .min(50, "Description must be at least 50 characters")
    .max(5000),
  category: z.string().min(1, "Please select a category"),
  deadline: z.string().refine((value) => {
    if (!value) return false;
    const dt = new Date(value);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return !Number.isNaN(dt.getTime()) && dt > today;
  }, "Job deadline must be in the future"),
  milestones: z
    .array(milestoneSchema)
    .min(1, "At least one milestone is required")
    .max(20, "You can add up to 20 milestones"),
});

type JobFormValues = z.infer<typeof jobSchema>;

export default function PostJobPage() {
  const { user, isLoading } = useAuth();
  const { balances } = useWallet();
  const router = useRouter();
  const { toast } = useToast();

  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState("");
  const [activeSkillIndex, setActiveSkillIndex] = useState(-1);
  const [paymentToken, setPaymentToken] = useState<(typeof PAYMENT_TOKENS)[number]>("XLM");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<JobFormValues>({
    resolver: zodResolver(jobSchema),
    mode: "onBlur",
    defaultValues: {
      title: "",
      description: "",
      category: "",
      deadline: "",
      milestones: [{ title: "", description: "", amount: "", deadline: "" }],
    },
  });
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: "milestones",
  });

  const moveMilestone = (from: number, to: number) => {
    if (to < 0 || to >= fields.length) return;
    move(from, to);
  };
  const milestones = watch("milestones");

  useEffect(() => {
    if (!isLoading && user !== null && user.role !== "CLIENT") {
      toast.error(
        "Only clients can post jobs. Switch your role in Settings.",
      );
      router.replace("/dashboard");
    }
  }, [isLoading, user, router, toast]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-stellar-blue" size={48} />
      </div>
    );
  }

  if (user?.role !== "CLIENT") {
    return null;
  }

  const addMilestone = () => {
    append({ title: "", description: "", amount: "", deadline: "" });
  };

  const removeMilestone = (index: number) => {
    if (fields.length > 1) {
      remove(index);
    }
  };
  const totalBudget = useMemo(
    () =>
      milestones.reduce((sum, m) => sum + (Number.parseFloat(m.amount) || 0), 0),
    [milestones],
  );

  const filteredSkillSuggestions = useMemo(() => {
    const query = skillInput.trim().toLowerCase();
    if (!query) return [];

    return JOB_SKILLS.filter(
      (skill) =>
        skill.toLowerCase().includes(query) && !skills.includes(skill),
    ).slice(0, 6);
  }, [skillInput, skills]);
  const selectedTokenBalance = useMemo(() => {
    const entry = balances.find((balance) => balance.asset === paymentToken);
    return Number.parseFloat(entry?.balance ?? "0");
  }, [balances, paymentToken]);
  const selectedTokenRequirement = totalBudget;
  const hasSufficientTokenBalance = selectedTokenBalance >= selectedTokenRequirement;

  const handleAddSkill = () => {
    const trimmed = skillInput.trim();
    if (!trimmed) return;

    const selectedSkill =
      activeSkillIndex >= 0 && filteredSkillSuggestions[activeSkillIndex]
        ? filteredSkillSuggestions[activeSkillIndex]
        : JOB_SKILLS.find(
            (skill) => skill.toLowerCase() === trimmed.toLowerCase(),
          ) ?? trimmed;

    if (!skills.includes(selectedSkill)) {
      setSkills([...skills, selectedSkill]);
    }
    setSkillInput("");
    setActiveSkillIndex(-1);
  };

  const handleRemoveSkill = (skill: string) => {
    setSkills(skills.filter((s) => s !== skill));
  };

  const selectSkillSuggestion = (skill: string) => {
    if (!skills.includes(skill)) {
      setSkills([...skills, skill]);
    }
    setSkillInput("");
    setActiveSkillIndex(-1);
  };

  const onSubmit = async (values: JobFormValues) => {
    setSubmitting(true);
    setError("");

    try {
      const token = localStorage.getItem("token");

      const res = await axios.post(
        `${API_URL}/jobs`,
        {
          title: values.title,
          description: values.description,
          category: values.category,
          deadline: new Date(values.deadline).toISOString(),
          skills,
          budget: totalBudget,
          paymentToken,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      for (const m of values.milestones) {
        await axios.post(
          `${API_URL}/milestones`,
          {
            jobId: res.data.id,
            title: m.title,
            description: m.description,
            amount: Number.parseFloat(m.amount),
            dueDate: m.deadline,
          },
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }

      router.push(`/jobs/${res.data.id}`);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.error || "Failed to post job. Please try again.");
      } else {
        setError("An unexpected error occurred.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-3xl font-bold text-theme-heading mb-2">Post a Job</h1>
      <p className="text-theme-text mb-8">
        Describe your project and set milestones. Funds will be locked in escrow
        when a freelancer is accepted.
      </p>

      <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
        {error && (
          <div className="p-3 rounded-lg bg-theme-error/10 border border-theme-error/20 text-theme-error text-sm">
            {error}
          </div>
        )}

        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-theme-heading mb-2">
            Job Title
          </label>
          <input
            type="text"
            placeholder="e.g., Build Soroban DEX Frontend"
            className="input-field"
            {...register("title")}
          />
          {errors.title && (
            <p className="mt-1 text-xs text-theme-error">{errors.title.message}</p>
          )}
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-theme-heading mb-2">
            Description
          </label>
          <textarea
            rows={6}
            placeholder="Describe the project requirements, scope, and deliverables..."
            className="input-field resize-none"
            {...register("description")}
          />
          {errors.description && (
            <p className="mt-1 text-xs text-theme-error">
              {errors.description.message}
            </p>
          )}
        </div>

        {/* Category */}
        <div>
          <label className="block text-sm font-medium text-theme-heading mb-2">
            Category
          </label>
          <select className="input-field" {...register("category")}>
            <option value="">Select a category</option>
            {JOB_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          {errors.category && (
            <p className="mt-1 text-xs text-theme-error">{errors.category.message}</p>
          )}
        </div>

        {/* Deadline */}
        <div>
          <label className="block text-sm font-medium text-theme-heading mb-2">
            Deadline
          </label>
          <input
            type="date"
            className="input-field"
            {...register("deadline")}
          />
          {errors.deadline && (
            <p className="mt-1 text-xs text-theme-error">{errors.deadline.message}</p>
          )}
        </div>

        {/* Skills */}
        <div>
          <label className="block text-sm font-medium text-theme-heading mb-2">
            Required Skills
          </label>
          <div className="relative flex gap-2 mb-3">
            <input
              type="text"
              placeholder="e.g., Rust"
              className="input-field"
              value={skillInput}
              onChange={(e) => {
                setSkillInput(e.target.value);
                setActiveSkillIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddSkill();
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveSkillIndex((index) =>
                    Math.min(index + 1, filteredSkillSuggestions.length - 1),
                  );
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveSkillIndex((index) => Math.max(index - 1, 0));
                } else if (e.key === "Escape") {
                  setActiveSkillIndex(-1);
                }
              }}
            />
            <button
              type="button"
              onClick={handleAddSkill}
              className="btn-secondary px-4 h-11 flex items-center justify-center"
            >
              <Plus size={20} />
            </button>
            {filteredSkillSuggestions.length > 0 && (
              <div className="absolute left-0 right-14 top-full z-20 mt-2 overflow-hidden rounded-xl border border-theme-border bg-theme-card shadow-2xl">
                {filteredSkillSuggestions.map((skill, index) => (
                  <button
                    key={skill}
                    type="button"
                    onClick={() => selectSkillSuggestion(skill)}
                    className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors ${
                      index === activeSkillIndex
                        ? "bg-stellar-blue/10 text-stellar-blue"
                        : "text-theme-text hover:bg-theme-border/40 hover:text-theme-heading"
                    }`}
                  >
                    <Tag size={14} /> {skill}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {skills.map((skill) => (
              <span
                key={skill}
                className="flex items-center gap-2 bg-theme-card border border-theme-border px-3 py-1.5 rounded-lg text-sm text-theme-text"
              >
                <Tag size={14} /> {skill}
                <button type="button" onClick={() => handleRemoveSkill(skill)}>
                  <Plus
                    className="rotate-45 text-theme-error hover:opacity-80 transition-colors"
                    size={16}
                  />
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Milestones */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <label className="text-sm font-medium text-theme-heading">
              Milestones
            </label>
            <button
              type="button"
              onClick={addMilestone}
              className="flex items-center gap-1 text-sm text-stellar-blue hover:text-stellar-purple transition-colors"
            >
              <Plus size={16} /> Add Milestone
            </button>
          </div>

          <div className="space-y-4">
            {fields.map((field, index) => (
              <div key={field.id} className="card relative">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-stellar-purple">
                    Milestone {index + 1}
                  </span>
                  <div className="flex items-center gap-2">
                    {fields.length > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={() => moveMilestone(index, index - 1)}
                          disabled={index === 0}
                          aria-label={`Move milestone ${index + 1} up`}
                          className="text-stellar-blue hover:text-stellar-purple transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <ArrowUp size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveMilestone(index, index + 1)}
                          disabled={index === fields.length - 1}
                          aria-label={`Move milestone ${index + 1} down`}
                          className="text-stellar-blue hover:text-stellar-purple transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <ArrowDown size={16} />
                        </button>
                      </>
                    )}
                    {milestones.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeMilestone(index)}
                        aria-label={`Remove milestone ${index + 1}`}
                        className="text-red-400 hover:text-red-300 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Milestone title"
                    className="input-field"
                    {...register(`milestones.${index}.title`)}
                  />
                  {errors.milestones?.[index]?.title && (
                    <p className="text-xs text-theme-error">
                      {errors.milestones[index]?.title?.message}
                    </p>
                  )}
                  <textarea
                    rows={2}
                    placeholder="Describe the deliverables for this milestone"
                    className="input-field resize-none"
                    {...register(`milestones.${index}.description`)}
                  />
                  {errors.milestones?.[index]?.description && (
                    <p className="text-xs text-theme-error">
                      {errors.milestones[index]?.description?.message}
                    </p>
                  )}
                  <div className="relative">
                    <input
                      type="number"
                      placeholder="Amount (XLM)"
                      className="input-field"
                      {...register(`milestones.${index}.amount`)}
                    />
                  </div>
                  {errors.milestones?.[index]?.amount && (
                    <p className="text-xs text-theme-error">
                      {errors.milestones[index]?.amount?.message}
                    </p>
                  )}
                  <input
                    type="date"
                    className="input-field"
                    {...register(`milestones.${index}.deadline`)}
                  />
                  {errors.milestones?.[index]?.deadline && (
                    <p className="text-xs text-theme-error">
                      {errors.milestones[index]?.deadline?.message}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
          {errors.milestones?.message && (
            <p className="mt-2 text-xs text-theme-error">
              {errors.milestones.message as string}
            </p>
          )}
        </div>

        {/* Total */}
        <div className="card flex items-center justify-between">
          <span className="text-theme-heading font-semibold">Total Budget</span>
          <span className="text-2xl font-bold bg-gradient-to-r from-stellar-blue to-stellar-purple bg-clip-text text-transparent">
            {totalBudget.toLocaleString()} XLM
          </span>
        </div>

        <div className="card">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-theme-text-muted">
                Payment token
              </p>
              <h3 className="mt-1 text-sm font-semibold text-theme-heading">
                Preview the escrow asset
              </h3>
            </div>
            <span className="rounded-full border border-theme-border px-2.5 py-1 text-xs text-theme-text">
              1 XLM ≈ 1 USDC
            </span>
          </div>

          <div className="flex flex-wrap gap-2 mb-3">
            {PAYMENT_TOKENS.map((token) => (
              <button
                key={token}
                type="button"
                onClick={() => setPaymentToken(token)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  paymentToken === token
                    ? "border-stellar-blue bg-stellar-blue/10 text-stellar-blue"
                    : "border-theme-border bg-theme-bg text-theme-text hover:border-stellar-blue hover:text-stellar-blue"
                }`}
              >
                {token}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-theme-text">
            <span>
              Wallet balance:{" "}
              {selectedTokenBalance.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}{" "}
              {paymentToken}
            </span>
            <span className="rounded-full border border-theme-border px-2 py-1">
              Required:{" "}
              {selectedTokenRequirement.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}{" "}
              {paymentToken}
            </span>
          </div>

          {!hasSufficientTokenBalance && (
            <p className="mt-3 text-xs text-theme-error">
              Insufficient {paymentToken} balance to cover this escrow preview.
            </p>
          )}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting || !hasSufficientTokenBalance}
          className="btn-primary w-full text-lg h-12 flex items-center justify-center gap-2"
        >
          {submitting ? <Loader2 className="animate-spin" size={24} /> : "Post Job & Fund Escrow"}
        </button>
      </form>
    </div>
  );
}
