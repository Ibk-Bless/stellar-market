"use client";

import { AlertTriangle, X } from "lucide-react";

type Props = {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function UnsavedChangesModal({ isOpen, onConfirm, onCancel }: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="bg-theme-card border border-theme-border rounded-xl shadow-xl max-w-md w-full p-6 animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex justify-between items-start mb-4">
          <div className="p-3 bg-theme-error/10 text-theme-error rounded-full">
            <AlertTriangle size={24} />
          </div>
          <button 
            onClick={onCancel}
            className="text-theme-text hover:text-theme-heading transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        
        <h3 className="text-xl font-bold text-theme-heading mb-2">
          Unsaved Changes
        </h3>
        <p className="text-theme-text mb-6">
          You have unsaved changes. Leave anyway?
        </p>
        
        <div className="flex gap-3 justify-end">
          <button 
            onClick={onCancel}
            className="btn-secondary flex-1 sm:flex-none"
          >
            Cancel
          </button>
          <button 
            onClick={onConfirm}
            className="btn-primary bg-theme-error hover:bg-theme-error/90 text-white flex-1 sm:flex-none border-0"
          >
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
