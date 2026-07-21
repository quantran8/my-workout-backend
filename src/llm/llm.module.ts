import { Global, Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { LlmConfig } from './llm.config';

@Global()
@Module({
  providers: [LlmService, LlmConfig],
  exports: [LlmService],
})
export class LlmModule {}
