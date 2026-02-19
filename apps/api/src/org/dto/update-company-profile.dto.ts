import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCompanyProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  companyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  productName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  productSummary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  idealCustomerProfile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  valueProposition?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  differentiators?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  proofPoints?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  repTalkingPoints?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  discoveryGuidance?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  qualificationGuidance?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12000)
  objectionHandling?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  competitorGuidance?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  pricingGuidance?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  implementationGuidance?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12000)
  faq?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  doNotSay?: string;
}
