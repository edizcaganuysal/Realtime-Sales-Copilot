import { Module } from '@nestjs/common';
import { PlaybooksController, PlaybookStagesController } from './playbooks.controller';
import { PlaybooksService } from './playbooks.service';

@Module({
  controllers: [PlaybooksController, PlaybookStagesController],
  providers: [PlaybooksService],
})
export class PlaybooksModule {}
