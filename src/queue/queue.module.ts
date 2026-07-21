import { Global, Module } from '@nestjs/common';
import { BossService } from './boss.service';

@Global()
@Module({
  providers: [BossService],
  exports: [BossService],
})
export class QueueModule {}
