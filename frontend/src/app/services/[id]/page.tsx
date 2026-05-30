"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Star, Tag, Clock, ChevronLeft, MessageSquare, ShieldCheck } from "lucide-react";
import axios from "axios";
import { ServiceListing } from "@/types";
import ShareMenu from "@/components/ShareMenu";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

export default function ServiceDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [service, setService] = useState<ServiceListing | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchService = async () => {
      try {
        const res = await axios.get(`${API_URL}/services/${id}`);
        setService(res.data);
      } catch (err) {
        console.error("Failed to fetch service detail", err);
      } finally {
        setLoading(false);
      }
    };
    if (id) fetchService();
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 flex justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-stellar-blue"></div>
      </div>
    );
  }

  if (!service) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center">
        <h2 className="text-2xl font-bold text-theme-heading">Service not found</h2>
        <button onClick={() => router.push('/services')} className="mt-4 text-stellar-blue hover:underline">
          Back to services
        </button>
      </div>
    );
  }

  const averageRating = service.freelancer.averageRating || 0;
  const reviewCount = service.freelancer.reviewCount || 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <button 
        onClick={() => router.back()}
        className="flex items-center gap-2 text-theme-text hover:text-theme-heading mb-8 transition-colors"
      >
        <ChevronLeft size={20} /> Back
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        {/* Main Content */}
        <div className="lg:col-span-2">
          <div className="mb-6">
            <span className="text-sm font-medium text-stellar-blue bg-stellar-blue/10 px-3 py-1 rounded-full mb-4 inline-block">
              {service.category}
            </span>
            <h1 className="text-4xl font-bold text-theme-heading mb-4">
              {service.title}
            </h1>
            <div className="flex items-center gap-6 text-sm text-theme-text">
              <div className="flex items-center gap-1 text-yellow-500">
                <Star size={18} fill="currentColor" />
                <span className="text-base font-semibold text-theme-heading">{averageRating}</span>
                <span className="text-sm text-theme-text">({reviewCount} reviews)</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock size={18} />
                <span>Listed on {new Date(service.createdAt).toLocaleDateString()}</span>
              </div>
              <ShareMenu 
                title={service.title}
                url={`/services/${id}`}
                description={service.description.slice(0, 140)}
              />
            </div>
          </div>

          <div className="prose prose-invert max-w-none mb-12">
            <h2 className="text-2xl font-bold text-theme-heading mb-4">About this service</h2>
            <div className="text-theme-text whitespace-pre-wrap text-lg leading-relaxed">
              {service.description}
            </div>
          </div>

          <div>
            <h3 className="text-xl font-bold text-theme-heading mb-4">Skills & Tech Stack</h3>
            <div className="flex flex-wrap gap-2">
              {service.skills.map((skill) => (
                <span key={skill} className="flex items-center gap-2 bg-theme-card border border-theme-border px-4 py-2 rounded-xl text-theme-heading">
                  <Tag size={16} className="text-stellar-purple" /> {skill}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="card sticky top-24">
            <div className="mb-6">
              <div className="text-sm text-theme-text mb-1 uppercase tracking-wider font-semibold">Service Price</div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold text-theme-heading">{service.price.toLocaleString()}</span>
                <span className="text-xl font-semibold text-stellar-blue">XLM</span>
              </div>
            </div>

            <div className="space-y-4 mb-8">
              <div className="flex items-center gap-3 text-sm text-theme-text">
                <ShieldCheck size={18} className="text-green-400" />
                <span>Secure Stellar Payment</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-theme-text">
                <MessageSquare size={18} className="text-stellar-blue" />
                <span>Direct Support</span>
              </div>
            </div>

            <button 
              onClick={() => router.push(`/messages?recipientId=${service.freelancerId}`)}
              className="btn-primary w-full flex items-center justify-center gap-2 h-12"
            >
              Contact Freelancer <MessageSquare size={20} />
            </button>
          </div>

          <div className="card">
            <h3 className="text-lg font-bold text-theme-heading mb-4">About the Seller</h3>
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-stellar-blue to-stellar-purple" />
              <div>
                <div className="font-bold text-theme-heading">{service.freelancer.username}</div>
                <div className="text-sm text-theme-text">{service.freelancer.role}</div>
              </div>
            </div>
            <p className="text-sm text-theme-text line-clamp-3 mb-4">
              {service.freelancer.bio || "No bio provided."}
            </p>
            <Link 
              href={`/profile/${service.freelancerId}`}
              className="text-sm text-stellar-blue hover:text-stellar-purple transition-colors font-semibold"
            >
              View Full Profile →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
