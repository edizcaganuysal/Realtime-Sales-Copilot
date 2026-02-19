import { IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSalesContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(240)
  companyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  whatWeSell?: string;

  @IsOptional()
  @IsString()
  @IsIn(['service', 'software', 'marketplace', 'other'])
  offerCategory?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  targetCustomer?: string;

  @IsOptional()
  @IsArray()
  targetRoles?: string[];

  @IsOptional()
  @IsArray()
  industries?: string[];

  @IsOptional()
  @IsArray()
  disqualifiers?: string[];

  @IsOptional()
  @IsArray()
  proofPoints?: string[];

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
  @IsString()
  @MaxLength(1000)
  schedulingLink?: string;

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
  @MaxLength(20000)
  knowledgeAppendix?: string;
}
