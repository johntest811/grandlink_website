export type ProductionRoleKey = "lead_welder" | "helper_welder" | "sealant_applicator" | "repair_staff";

export type ProductionStageKey =
  | "material_preparation"
  | "frame_fabrication_welding"
  | "glass_installation"
  | "sealant_application";

export type WorkflowStageMeta = {
  key: ProductionStageKey;
  label: string;
  order: number;
  required_role_keys: ProductionRoleKey[];
  assigned_admin_ids: string[];
  task_ids: number[];
  approved_task_ids: number[];
  approved_update_ids: string[];
  last_submission_at?: string | null;
  approved_at?: string | null;
  status: "pending" | "in_progress" | "approved";
};

export type WorkflowMember = {
  admin_id: string;
  admin_name: string;
  employee_number?: string | null;
  position?: string | null;
  role_keys: ProductionRoleKey[];
  role_labels: string[];
};

export type WorkflowTaskMeta = {
  task_id: number;
  assigned_admin_id: string;
  employee_name: string;
  employee_number?: string | null;
  role_key: ProductionRoleKey;
  role_label: string;
  stage_key: ProductionStageKey;
  stage_label: string;
  due_date?: string | null;
};

export type ProductionWorkflowMeta = {
  version: number;
  estimated_completion_date?: string | null;
  final_product_images: string[];
  final_product_note?: string | null;
  final_product_update_id?: string | null;
  last_updated_at?: string | null;
  started_at?: string | null;
  team_members: WorkflowMember[];
  stage_plans: WorkflowStageMeta[];
  task_registry: WorkflowTaskMeta[];
};

export const PRODUCTION_STAGES = [
  {
    key: "material_preparation",
    label: "Material Preparation Stage",
    order: 1,
    roleKeys: ["lead_welder", "helper_welder", "repair_staff"],
  },
  {
    key: "frame_fabrication_welding",
    label: "Frame Fabrication & Welding",
    order: 2,
    roleKeys: ["lead_welder", "helper_welder"],
  },
  {
    key: "glass_installation",
    label: "Glass Installation",
    order: 3,
    roleKeys: ["lead_welder", "helper_welder", "repair_staff"],
  },
  {
    key: "sealant_application",
    label: "Sealant Application",
    order: 4,
    roleKeys: ["sealant_applicator"],
  },
] as const;

export function ensureProductionWorkflow(raw: unknown): ProductionWorkflowMeta {
  const input = raw && typeof raw === "object" ? (raw as Partial<ProductionWorkflowMeta>) : {};
  const stageMap = new Map<string, WorkflowStageMeta>();

  for (const stage of PRODUCTION_STAGES) {
    stageMap.set(stage.key, {
      key: stage.key,
      label: stage.label,
      order: stage.order,
      required_role_keys: [...stage.roleKeys],
      assigned_admin_ids: [],
      task_ids: [],
      approved_task_ids: [],
      approved_update_ids: [],
      last_submission_at: null,
      approved_at: null,
      status: "pending",
    });
  }

  if (Array.isArray(input.stage_plans)) {
    for (const stage of input.stage_plans) {
      if (!stage || typeof stage !== "object") continue;
      const key = String((stage as WorkflowStageMeta).key || "") as ProductionStageKey;
      if (!stageMap.has(key)) continue;
      const base = stageMap.get(key)!;
      stageMap.set(key, {
        ...base,
        ...(stage as WorkflowStageMeta),
        label: PRODUCTION_STAGES.find((entry) => entry.key === key)?.label || base.label,
        order: PRODUCTION_STAGES.find((entry) => entry.key === key)?.order || base.order,
        required_role_keys: [...(PRODUCTION_STAGES.find((entry) => entry.key === key)?.roleKeys || base.required_role_keys)],
      });
    }
  }

  return {
    version: 1,
    estimated_completion_date: input.estimated_completion_date || null,
    final_product_images: Array.isArray(input.final_product_images) ? input.final_product_images.filter(Boolean) : [],
    final_product_note: input.final_product_note || null,
    final_product_update_id: input.final_product_update_id || null,
    started_at: input.started_at || null,
    last_updated_at: input.last_updated_at || null,
    team_members: Array.isArray(input.team_members) ? (input.team_members.filter(Boolean) as WorkflowMember[]) : [],
    stage_plans: PRODUCTION_STAGES.map((stage) => {
      const current = stageMap.get(stage.key)!;
      const approved = current.task_ids.length > 0 && current.approved_task_ids.length >= current.task_ids.length;
      return {
        ...current,
        status: approved ? "approved" : current.approved_task_ids.length > 0 || current.last_submission_at ? "in_progress" : "pending",
      };
    }),
    task_registry: Array.isArray(input.task_registry) ? (input.task_registry.filter(Boolean) as WorkflowTaskMeta[]) : [],
  };
}
