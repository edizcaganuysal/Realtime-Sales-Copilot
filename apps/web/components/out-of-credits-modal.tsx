'use client';

import Link from 'next/link';
import { Modal } from '@/components/ui/modal';

interface OutOfCreditsModalProps {
  open: boolean;
  onClose: () => void;
}

export function OutOfCreditsModal({ open, onClose }: OutOfCreditsModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="You’re out of credits" className="max-w-md">
      <p className="text-sm text-slate-300">
        Add credits or upgrade your plan to continue.
      </p>
      <div className="mt-4 flex gap-2">
        <Link
          href="/app/billing?tab=add-credits"
          onClick={onClose}
          className="inline-flex flex-1 items-center justify-center rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500"
        >
          Add credits
        </Link>
        <Link
          href="/app/billing?tab=upgrade"
          onClick={onClose}
          className="inline-flex flex-1 items-center justify-center rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-slate-500 hover:text-white"
        >
          Upgrade plan
        </Link>
      </div>
    </Modal>
  );
}
