'use client';

import { Button } from '@fuseai/ui/components/button';
import { Dialog } from '@fuseai/ui/components/dialog';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ProjectStep } from '@/components/onboarding/project-step';

export function NewProjectButton({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="brand" onClick={() => setOpen(true)}>
        <Plus /> Novo projeto
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Novo projeto">
        <ProjectStep
          orgId={orgId}
          onCreated={(project) => {
            setOpen(false);
            router.push(`/app/projetos/${project.id}`);
            router.refresh();
          }}
        />
      </Dialog>
    </>
  );
}
