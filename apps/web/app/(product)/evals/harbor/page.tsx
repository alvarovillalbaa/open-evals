import { LinkButton, PageHeader } from "../../components";
import { HarborWorkbench } from "./harbor-workbench";

export default function HarborPage() {
  return <div className="grid min-w-0 gap-6"><PageHeader title="Harbor tasks" actions={<LinkButton href="/evals">Evals</LinkButton>} />
    <p className="max-w-3xl text-sm text-muted-foreground">Version a task, select its exact source into a plan, and run Harbor on your own machine. Saving and previewing never start a container or call a model.</p>
    <HarborWorkbench />
  </div>;
}
