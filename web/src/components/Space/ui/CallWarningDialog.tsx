import type React from "react";

interface CallWarningDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  confirmVariant?: "danger" | "default";
  onCancel?: () => void;
  onConfirm: () => void;
}

const CallWarningDialog: React.FC<CallWarningDialogProps> = ({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  confirmVariant = "danger",
  onCancel,
  onConfirm,
}) => {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm">
      <div
        className="w-full max-w-[380px] rounded-xl border border-call-border bg-call-background p-5 shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="call-warning-title"
        aria-describedby="call-warning-description"
      >
        <div className="mb-5">
          <h2
            id="call-warning-title"
            className="text-base font-semibold text-foreground"
          >
            {title}
          </h2>
          <p
            id="call-warning-description"
            className="mt-2 text-sm leading-5 text-foreground/65"
          >
            {description}
          </p>
        </div>

        <div className="flex justify-end gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-call-border bg-call-primary px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-primary-hover"
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            className={
              confirmVariant === "danger"
                ? "rounded-lg border border-red-400/20 bg-red-500 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600"
                : "rounded-lg border border-call-border bg-primary px-3.5 py-2 text-sm font-semibold text-primary-text transition-colors hover:bg-primary/85"
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CallWarningDialog;
