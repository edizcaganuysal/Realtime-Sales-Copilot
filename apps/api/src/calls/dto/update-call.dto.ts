import { IsArray, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { ProductsMode } from '@live-sales-coach/shared';

export class UpdateCallDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn([ProductsMode.ALL, ProductsMode.SELECTED])
  products_mode?: ProductsMode;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  selected_product_ids?: string[];
}
