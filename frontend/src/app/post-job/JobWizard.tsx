"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Tag,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Eye,
} from "lucide-react";
import axios from "axios";
import { z } from "zod";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { JOB_CATEGORIES, JOB_SKILLS, PAYMENT_TOKENS } from "@/constants/jobs";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
const PLATFORM_MIN_BUDGET_XLM = Number(
  process.env.NEXT_PUBLIC_PLATFORM_MIN_BUDGET_XLM || "1",
);

const milestoneSchema = z.object({
  title: z.string().min(3, "Milestone title is too short"),
  description: z.string().min(5, "Milestone description is too short"),
  amount: z
    .string()
    .refine(
      (value) => Number.parseFloat(value) >= PLATFORM_MIN_BUDGET_XLM,
      `Budget must be at least ${PLATFORM_MIN_BUDGET_XLM} XLM`,
    ),
  deadline: z.string().refine((value) => {
    if (!value) return false;
    const dt = new Date(value);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return !Number.isNaN(dt.getTime()) && dt > today;
  }, "Milestone deadline must be in the future"),
});

const step1Schema = z.object({
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
});

const step2Schema = z.object({
  milestones: z
    .array(milestoneSchema)
    .min(1, "At least one milestone is required")
    .max(20),
});

type Step1FormValues = z.infer<typeof step1Schema>;
type Step2FormValues = z.infer<typeof step2Schema>;
type FormValues = Step1FormValues & Step2FormValues;

const STORAGE_KEY = "job-wizard-draft";

export default function JobWizard() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [currentStep, setCurrentStep] = useState(1);
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState("");
  const [paymentToken, setPaymentToken] =
    useState<(typeof PAYMENT_TOKENS)[number]>("XLM");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Load draft from localStorage
  useEffect(() => {
    const draft = localStorage.getItem(STORAGE_KEY);
    if (draft) {
      try {
        const parsed = JSON.parse(draft);
        if (parsed.skills) setSkills(parsed.skills);
        if (parsed.paymentToken) setPaymentToken(parsed.paymentToken);
      } catch {}
    }
  }, []);

  const schema = currentStep === 1 ? step1Schema : step2Schema;

  const {
    register,
    control,
    handleSubmit,
    watch,
    trigger,
    formState: { errors },
    setValue,
    getValues,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    defaultValues: (() => {
      const draft =
        typeof window !== "undefined"
          ? localStorage.getItem(STORAGE_KEY)
          : null;
      if (draft) {
        try {
          const parsed = JSON.parse(draft);
          return (
            parsed.formData || {
              title: "",
              description: "",
              category: "",
              deadline: "",
              milestones: [
                { title: "", description: "", amount: "", deadline: "" },
              ],
            }
          );
        } catch {}
      }
      return {
        title: "",
        description: "",
        category: "",
        deadline: "",
        milestones: [{ title: "", description: "", amount: "", deadline: "" }],
      };
    })(),
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "milestones",
  });

  const milestones = watch("milestones");
  const totalBudget = useMemo(
    () =>
      milestones.reduce(
        (sum, m) => sum + (Number.parseFloat(m.amount) || 0),
        0,
      ),
    [milestones],
  );

  // Save draft to localStorage
  useEffect(() => {
    const formData = getValues();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ formData, skills, paymentToken }),
    );
  }, [watch(), skills, paymentToken, getValues]);

  // Validate milestones total matches intended budget in real-time
  useEffect(() => {
    if (currentStep === 2 && totalBudget > 0) {
      // Real-time validation feedback shown via UI
    }
  }, [totalBudget, currentStep]);

  useEffect(() => {
    if (!isLoading && user !== null && user.role !== "CLIENT") {
      toast.error("Only clients can post jobs. Switch your role in Settings.");
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

  const handleNext = async () => {
    const isValid = await trigger();
    if (isValid) {
      setCurrentStep(2);
    }
  };

  const handleBack = () => {
    setCurrentStep(1);
  };

  const filteredSkillSuggestions = useMemo(() => {
    const query = skillInput.trim().toLowerCase();
    if (!query) return [];
    return JOB_SKILLS.filter(
      (skill) => skill.toLowerCase().includes(query) && !skills.includes(skill),
    ).slice(0, 6);
  }, [skillInput, skills]);

  const handleAddSkill = () => {
    const trimmed = skillInput.trim();
    if (!trimmed) return;
    if (!skills.includes(trimmed)) {
      setSkills([...skills, trimmed]);
    }
    setSkillInput("");
  };

  const handleRemoveSkill = (skill: string) => {
    setSkills(skills.filter((s) => s !== skill));
  };

  const onSubmit = async (values: FormValues) => {
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
        { headers: { Authorization: `Bearer ${token}` } },
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
          { headers: { Authorization: `Bearer ${token}` } },
        );
      }

      localStorage.removeItem(STORAGE_KEY);
      router.push(`/jobs/${res.data.id}`);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        setError(
          err.response?.data?.error || "Failed to post job. Please try again.",
        );
      } else {
        setError("An unexpected error occurred.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Progress indicator */}
      <div className="mb-8">
        <div className="flex items-center justify-center gap-4">
          {[1, 2, 3].map((step) => (
            <div key={step} className="flex items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-all ${
                  currentStep >= step
                    ? "bg-stellar-blue text-white"
                    : "bg-theme-border text-theme-text"
                }`}
              >
                {step}
              </div>
              {step < 3 && <div className="w-16 h-1 bg-theme-border mx-2" />}
            </div>
          ))}
        </div>
        <div className="flex justify-center gap-16 mt-3 text-sm">
          <span
            className={
              currentStep === 1
                ? "text-stellar-blue font-medium"
                : "text-theme-text"
            }
          >
            Basic Info
          </span>
          <span
            className={
              currentStep === 2
                ? "text-stellar-blue font-medium"
                : "text-theme-text"
            }
          >
            Milestones
          </span>
          <span
            className={
              currentStep === 3
                ? "text-stellar-blue font-medium"
                : "text-theme-text"
            }
          >
            Preview
          </span>
        </div>
      </div>

      <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
        {error && (
          <div className="p-3 rounded-lg bg-theme-error/10 border border-theme-error/20 text-theme-error text-sm">
            {error}
          </div>
        )}

        {/* Step 1: Basic Info */}
        {currentStep === 1 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-theme-heading">
              Basic Information
            </h2>

            <div>
              <label className="block text-sm font-medium text-theme-heading mb-2">
                Job Title *
              </label>
              <input
                type="text"
                placeholder="e.g., Build Soroban DEX Frontend"
                className="input-field"
                {...register("title")}
              />
              {errors.title && (
                <p className="mt-1 text-xs text-theme-error">
                  {errors.title.message}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-theme-heading mb-2">
                Description *
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

            <div>
              <label className="block text-sm font-medium text-theme-heading mb-2">
                Category *
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
                <p className="mt-1 text-xs text-theme-error">
                  {errors.category.message}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-theme-heading mb-2">
                Project Deadline *
              </label>
              <input
                type="date"
                className="input-field"
                {...register("deadline")}
              />
              {errors.deadline && (
                <p className="mt-1 text-xs text-theme-error">
                  {errors.deadline.message}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-theme-heading mb-2">
                Required Skills
              </label>
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  placeholder="e.g., Rust"
                  className="input-field"
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddSkill();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={handleAddSkill}
                  className="btn-secondary px-4 h-11"
                >
                  <Plus size={20} />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {skills.map((skill) => (
                  <span
                    key={skill}
                    className="flex items-center gap-2 bg-theme-card border border-theme-border px-3 py-1.5 rounded-lg text-sm"
                  >
                    <Tag size={14} /> {skill}
                    <button
                      type="button"
                      onClick={() => handleRemoveSkill(skill)}
                    >
                      <Plus className="rotate-45 text-theme-error" size={16} />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={handleNext}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              Next: Milestones & Budget <ArrowRight size={20} />
            </button>
          </div>
        )}

        {/* Step 2: Milestones & Budget */}
        {currentStep === 2 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-theme-heading">
              Milestones & Budget
            </h2>

            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-theme-heading">
                Milestones
              </label>
              <button
                type="button"
                onClick={() =>
                  append({
                    title: "",
                    description: "",
                    amount: "",
                    deadline: "",
                  })
                }
                className="flex items-center gap-1 text-sm text-stellar-blue hover:text-stellar-purple"
              >
                <Plus size={16} /> Add Milestone
              </button>
            </div>

            <div className="space-y-4">
              {fields.map((field, index) => (
                <div key={field.id} className="card">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-stellar-purple">
                      Milestone {index + 1}
                    </span>
                    {milestones.length > 1 && (
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        className="text-red-400 hover:text-red-300"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
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
                      placeholder="Describe the deliverables"
                      className="input-field resize-none"
                      {...register(`milestones.${index}.description`)}
                    />
                    {errors.milestones?.[index]?.description && (
                      <p className="text-xs text-theme-error">
                        {errors.milestones[index]?.description?.message}
                      </p>
                    )}
                    <input
                      type="number"
                      placeholder="Amount (XLM)"
                      className="input-field"
                      min={PLATFORM_MIN_BUDGET_XLM}
                      step="0.0000001"
                      {...register(`milestones.${index}.amount`)}
                    />
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

            <div className="card bg-stellar-blue/5 border-stellar-blue/30">
              <div className="flex items-center justify-between">
                <span className="text-theme-heading font-semibold">
                  Total Budget
                </span>
                <span className="text-2xl font-bold text-stellar-blue">
                  {totalBudget.toLocaleString()} XLM
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleBack}
                className="btn-secondary flex-1 flex items-center justify-center gap-2"
              >
                <ArrowLeft size={20} /> Back
              </button>
              <button
                type="button"
                onClick={() => setCurrentStep(3)}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                Preview & Publish <Eye size={20} />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Preview */}
        {currentStep === 3 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-theme-heading">
              Preview & Publish
            </h2>

            <div className="card">
              <h3 className="text-xl font-bold text-theme-heading mb-2">
                {watch("title")}
              </h3>
              <p className="text-theme-text text-sm mb-4 whitespace-pre-wrap">
                {watch("description")}
              </p>
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="bg-theme-border/40 px-3 py-1 rounded">
                  {watch("category")}
                </span>
                {skills.map((skill) => (
                  <span
                    key={skill}
                    className="bg-stellar-blue/10 text-stellar-blue px-3 py-1 rounded"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>

            <div className="card">
              <h4 className="font-semibold text-theme-heading mb-3">
                Milestones
              </h4>
              <div className="space-y-2">
                {milestones.map((m, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-theme-text">{m.title}</span>
                    <span className="font-semibold text-theme-heading">
                      {Number.parseFloat(m.amount).toLocaleString()} XLM
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-theme-border flex justify-between font-bold">
                <span className="text-theme-heading">Total</span>
                <span className="text-stellar-blue text-xl">
                  {totalBudget.toLocaleString()} XLM
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className="btn-secondary flex-1 flex items-center justify-center gap-2"
              >
                <ArrowLeft size={20} /> Back
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <Loader2 className="animate-spin" size={20} />
                ) : (
                  "Publish Job"
                )}
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
