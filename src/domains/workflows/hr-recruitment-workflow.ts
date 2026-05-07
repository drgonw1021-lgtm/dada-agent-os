import { DomainWorkflow, type WorkflowStep } from "../domain-workflow.js";
import { parseJsonFromLLMOutput } from "../llm-output-parser.js";

const STEPS: WorkflowStep[] = [
  {
    id: "job_analysis",
    name: "职位分析",
    description: "分析招聘需求和制定JD",
    async execute(ctx) {
      try {
        const prompt = `你是一个专业HR招聘专家。分析以下招聘需求并制定职位描述（JD）：
目标：${ctx.goal}
请提供：1. 职位名称和级别 2. 核心职责(5-8条) 3. 必备技能和资质 4. 加分项 5. 薪资范围建议 6. 面试流程建议
用JSON格式返回，字段：title, responsibilities, requirements, nice_to_have, salary_range, interview_process`;
        const output = await ctx.complete(prompt);
        ctx.data.set("job_analysis", { raw: output, parsed: parseJsonFromLLMOutput(output) });
        return { success: true, output: ctx.data.get("job_analysis") };
      } catch (e: any) { return { success: false, error: e.message }; }
    }
  },
  {
    id: "candidate_screening",
    name: "候选人筛选",
    description: "制定筛选标准和评估方案",
    async execute(ctx) {
      try {
        const job = ctx.data.get("job_analysis");
        const prompt = `基于以下JD，制定候选人筛选和评估方案：
JD：${JSON.stringify(job?.parsed || job?.raw || "")}
目标：${ctx.goal}
请提供：1. 筛选维度(4-5个) 2. 每维度评分标准 3. 面试问题库(8-10题) 4. 评估打分表 5. 背景调查要点
用JSON格式返回，字段：dimensions, scoring_criteria, interview_questions, evaluation_form, background_check`;
        const output = await ctx.complete(prompt);
        ctx.data.set("screening", { raw: output, parsed: parseJsonFromLLMOutput(output) });
        return { success: true, output: ctx.data.get("screening") };
      } catch (e: any) { return { success: false, error: e.message }; }
    }
  },
  {
    id: "onboarding_plan",
    name: "入职计划",
    description: "制定入职和培训计划",
    async execute(ctx) {
      try {
        const job = ctx.data.get("job_analysis");
        const prompt = `基于以下职位信息，制定新员工入职和培训计划：
职位：${JSON.stringify(job?.parsed || job?.raw || "")}
目标：${ctx.goal}
请提供：1. 入职第1周计划 2. 第1月计划 3. 第3月计划 4. 导师安排 5. 考核节点 6. 留任策略
用JSON格式返回，字段：week1, month1, month3, mentorship, checkpoints, retention`;
        const output = await ctx.complete(prompt);
        ctx.data.set("onboarding", { raw: output, parsed: parseJsonFromLLMOutput(output) });
        return { success: true, output: ctx.data.get("onboarding") };
      } catch (e: any) { return { success: false, error: e.message }; }
    }
  }
];

export class HrRecruitmentWorkflow extends DomainWorkflow {
  id = "hr-recruitment";
  name = "HR招聘";
  steps = STEPS;
}
