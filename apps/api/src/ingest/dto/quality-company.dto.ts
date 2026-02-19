import { IsOptional, IsString, MaxLength } from 'class-validator';

export class QualityCompanyDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  companyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  productName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16000)
  productSummary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16000)
  idealCustomerProfile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32000)
  valueProposition?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32000)
  differentiators?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32000)
  proofPoints?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32000)
  repTalkingPoints?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32000)
  discoveryGuidance?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32000)
  qualificationGuidance?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32000)
  objectionHandling?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32000)
  competitorGuidance?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32000)
  pricingGuidance?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32000)
  implementationGuidance?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32000)
  faq?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16000)
  doNotSay?: string;
}
