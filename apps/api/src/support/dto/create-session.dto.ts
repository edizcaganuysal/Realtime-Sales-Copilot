import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateSessionDto {
  @IsOptional()
  @IsUUID()
  agentId?: string;

  @IsOptional()
  @IsUUID()
  callId?: string;

  @IsString()
  phoneTo!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
