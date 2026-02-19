import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Role } from '@live-sales-coach/shared';
import type { JwtPayload } from '@live-sales-coach/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { IngestService, type UploadedPdfFile } from './ingest.service';
import { CreateWebsiteIngestDto } from './dto/create-website-ingest.dto';
import { QualityCompanyDto } from './dto/quality-company.dto';
import { QualityProductDto } from './dto/quality-product.dto';
import { AiFieldDraftDto } from './dto/ai-field-draft.dto';
import { AiFieldImproveDto } from './dto/ai-field-improve.dto';

@Controller('ingest')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IngestController {
  constructor(private readonly ingestService: IngestService) {}

  @Post('company/website')
  @Roles(Role.ADMIN)
  ingestCompanyWebsite(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateWebsiteIngestDto,
  ) {
    return this.ingestService.queueWebsiteJob(user, 'COMPANY', dto);
  }

  @Post('company/pdfs')
  @Roles(Role.ADMIN)
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  ingestCompanyPdfs(
    @CurrentUser() user: JwtPayload,
    @UploadedFiles() files: UploadedPdfFile[],
  ) {
    return this.ingestService.queuePdfJob(user, 'COMPANY', files);
  }

  @Post('product/website')
  @Roles(Role.MANAGER)
  ingestProductWebsite(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateWebsiteIngestDto,
  ) {
    return this.ingestService.queueWebsiteJob(user, 'PRODUCT', dto);
  }

  @Post('product/pdfs')
  @Roles(Role.MANAGER)
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  ingestProductPdfs(
    @CurrentUser() user: JwtPayload,
    @UploadedFiles() files: UploadedPdfFile[],
  ) {
    return this.ingestService.queuePdfJob(user, 'PRODUCT', files);
  }

  @Get('jobs/:jobId')
  @Roles(Role.MANAGER)
  getJob(@CurrentUser() user: JwtPayload, @Param('jobId') jobId: string) {
    return this.ingestService.getJob(user.orgId, jobId);
  }

  @Post('jobs/:jobId/apply')
  @Roles(Role.MANAGER)
  applyJob(
    @CurrentUser() user: JwtPayload,
    @Param('jobId') jobId: string,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.ingestService.applyJob(user.orgId, jobId, payload);
  }
}

@Controller('quality')
@UseGuards(JwtAuthGuard, RolesGuard)
export class QualityController {
  constructor(private readonly ingestService: IngestService) {}

  @Post('company')
  @Roles(Role.MANAGER)
  company(@Body() dto: QualityCompanyDto) {
    return this.ingestService.qualityCompany(dto);
  }

  @Post('product')
  @Roles(Role.MANAGER)
  product(@Body() dto: QualityProductDto) {
    return this.ingestService.qualityProduct(dto);
  }
}

@Controller('ai/fields')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.MANAGER)
export class AiFieldsController {
  constructor(private readonly ingestService: IngestService) {}

  @Get('status')
  status() {
    return this.ingestService.aiFieldsStatus();
  }

  @Post('draft')
  draft(@Body() dto: AiFieldDraftDto) {
    return this.ingestService.aiFieldDraft(dto);
  }

  @Post('improve')
  improve(@Body() dto: AiFieldImproveDto) {
    return this.ingestService.aiFieldImprove(dto);
  }
}
