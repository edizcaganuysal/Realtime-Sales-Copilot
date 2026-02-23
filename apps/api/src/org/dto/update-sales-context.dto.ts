import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateSalesContextDto {
  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  whatWeSell?: string;

  @IsOptional()
  @IsString()
  howItWorks?: string;

  @IsOptional()
  @IsString()
  strategy?: string;

  @IsOptional()
  @IsString()
  @IsIn(['service', 'software', 'marketplace', 'other'])
  offerCategory?: string;

  @IsOptional()
  @IsString()
  targetCustomer?: string;

  @IsOptional()
  @IsArray()
  targetRoles?: string[];

  @IsOptional()
  @IsArray()
  industries?: string[];

  @IsOptional()
  @IsArray()
  buyingTriggers?: string[];

  @IsOptional()
  @IsArray()
  disqualifiers?: string[];

  @IsOptional()
  @IsArray()
  globalValueProps?: string[];

  @IsOptional()
  @IsArray()
  proofPoints?: string[];

  @IsOptional()
  @IsArray()
  caseStudies?: string[];

  @IsOptional()
  @IsArray()
  allowedClaims?: string[];

  @IsOptional()
  @IsArray()
  forbiddenClaims?: string[];

  @IsOptional()
  @IsArray()
  salesPolicies?: string[];

  @IsOptional()
  @IsArray()
  escalationRules?: string[];

  @IsOptional()
  @IsArray()
  nextSteps?: string[];

  @IsOptional()
  @IsArray()
  competitors?: string[];

  @IsOptional()
  @IsArray()
  positioningRules?: string[];

  @IsOptional()
  @IsArray()
  discoveryQuestions?: string[];

  @IsOptional()
  @IsArray()
  qualificationRubric?: string[];

  @IsOptional()
  @IsString()
  knowledgeAppendix?: string;
}
