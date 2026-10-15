import { Button } from '@fusai/ui/components/button';
import { Download } from 'lucide-react';
import { API_URL } from '@/lib/config';

/** Downloads a CSV straight from the API (the session cookie goes with the top-level navigation). */
export function ExportCsvButton({
  path,
  label = 'Exportar CSV',
}: {
  path: string;
  label?: string;
}) {
  return (
    <Button asChild variant="outline" size="sm">
      <a href={`${API_URL}${path}`} download>
        <Download /> {label}
      </a>
    </Button>
  );
}
