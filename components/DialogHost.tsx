'use client';

import { useSyncExternalStore } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getDialogQueue, getServerDialogQueue, settleDialog, subscribeDialogs } from '@/lib/dialog';

/** Vẽ hộp thoại của lib/dialog.ts (showAlert / showConfirm). Gắn một lần trong AppShell. */
export function DialogHost() {
  const queue = useSyncExternalStore(subscribeDialogs, getDialogQueue, getServerDialogQueue);
  const d = queue[0];
  if (!d) return null;
  const Icon = d.danger ? AlertTriangle : Info;

  return (
    <Dialog key={d.id} open onOpenChange={(open) => !open && settleDialog(d.id, false)}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${d.danger ? 'bg-red-50 text-red-600' : 'bg-indigo-50 text-indigo-600'}`}>
              <Icon className="h-4 w-4" />
            </span>
            {d.title}
          </DialogTitle>
          <DialogDescription className="whitespace-pre-line text-sm text-slate-600">{d.message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {d.kind === 'confirm' && (
            <Button variant="outline" onClick={() => settleDialog(d.id, false)}>
              {d.cancelText}
            </Button>
          )}
          <Button
            autoFocus
            onClick={() => settleDialog(d.id, true)}
            className={d.danger ? 'bg-red-600 text-white hover:bg-red-700' : undefined}
          >
            {d.confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
