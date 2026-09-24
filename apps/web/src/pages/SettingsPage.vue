<script setup lang="ts">
/**
 * 系统设置页。
 *
 * 当前集中管理：
 * - 自动价格检测计划；
 * - 喵喵折 Token；
 * - 管理员账号。
 *
 * 自动检测计划在 v1.6.0 改为“后台可配置”：Cloudflare Cron 自身每分钟唤醒，
 * 但只有命中这里保存的时间才会把 Monitor 投递到 Queue。
 * v1.6.1 增加运行状态轮询：Cron/Queue 在服务端完成后，页面无需手动刷新即可看到最新状态。
 */
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

import {
  api,
  type PriceCheckScheduleSetting,
  type TokenSetting,
} from '../api'
import { showError } from '../ui'

const tokenSetting = ref<TokenSetting | null>(null)
const token = ref('')
const validationUrl = ref('')

const scheduleSetting = ref<PriceCheckScheduleSetting | null>(null)
const newScheduleTime = ref('')
const savingSchedule = ref(false)

/**
 * 表单使用独立对象，不直接改 scheduleSetting。
 * 这样用户尚未点击“保存”时，页面仍能区分“服务端当前值”和“正在编辑的值”。
 */
const schedule = reactive({
  enabled: true,
  timezone: 'Asia/Shanghai',
  times: ['09:00', '15:00', '21:00'] as string[],
})

const timezoneOptions = [
  { label: '中国标准时间（Asia/Shanghai）', value: 'Asia/Shanghai' },
  { label: '香港（Asia/Hong_Kong）', value: 'Asia/Hong_Kong' },
  { label: '新加坡（Asia/Singapore）', value: 'Asia/Singapore' },
  { label: '东京（Asia/Tokyo）', value: 'Asia/Tokyo' },
  { label: '芝加哥（America/Chicago）', value: 'America/Chicago' },
  { label: '协调世界时（UTC）', value: 'UTC' },
]

const account = reactive({
  currentPassword: '',
  username: '',
  newPassword: '',
})

/** 页面打开时并行读取两个互不依赖的系统设置。 */
async function load() {
  try {
    const [tokenResult, scheduleResult] = await Promise.all([
      api.tokenSetting(),
      api.priceCheckSchedule(),
    ])

    tokenSetting.value = tokenResult
    applyScheduleResult(scheduleResult)
  } catch (error) {
    showError(error)
  }
}

function applyScheduleResult(result: PriceCheckScheduleSetting) {
  scheduleSetting.value = result
  schedule.enabled = result.enabled
  schedule.timezone = result.timezone
  schedule.times = [...result.times]
}

function addScheduleTime() {
  if (!newScheduleTime.value) return

  if (schedule.times.includes(newScheduleTime.value)) {
    ElMessage.info('这个时间已经存在')
    return
  }

  if (schedule.times.length >= 24) {
    ElMessage.warning('每天最多配置 24 个检测时间')
    return
  }

  schedule.times.push(newScheduleTime.value)
  schedule.times.sort()
  newScheduleTime.value = ''
}

function removeScheduleTime(time: string) {
  schedule.times = schedule.times.filter((item) => item !== time)
}

/** 快速恢复升级前的固定三次检测时间，但仍需点击“保存计划”才会写入 D1。 */
function restoreDefaultSchedule() {
  schedule.enabled = true
  schedule.timezone = 'Asia/Shanghai'
  schedule.times = ['09:00', '15:00', '21:00']
}

async function saveSchedule() {
  if (schedule.enabled && schedule.times.length === 0) {
    ElMessage.warning('启用自动检测时至少需要配置一个检测时间')
    return
  }

  savingSchedule.value = true
  try {
    const result = await api.savePriceCheckSchedule({
      enabled: schedule.enabled,
      timezone: schedule.timezone,
      times: [...schedule.times].sort(),
    })

    applyScheduleResult(result)
    ElMessage.success('自动检测计划已保存')
  } catch (error) {
    showError(error)
  } finally {
    savingSchedule.value = false
  }
}

async function saveToken() {
  try {
    tokenSetting.value = await api.saveToken(
      token.value,
      validationUrl.value || undefined,
    )
    token.value = ''
    ElMessage.success('Token 已验证并保存')
  } catch (error) {
    showError(error)
  }
}

async function saveAccount() {
  try {
    const result = await api.updateAccount({
      currentPassword: account.currentPassword,
      username: account.username || undefined,
      newPassword: account.newPassword || undefined,
    })

    account.currentPassword = ''
    account.newPassword = ''
    account.username = result.username
    ElMessage.success('账号设置已更新')
  } catch (error) {
    showError(error)
  }
}

/** 系统设置页只需要轻量轮询自动检测运行状态，不重复拉 Token。 */
const SCHEDULE_STATUS_REFRESH_MS = 10_000
let scheduleRefreshTimer: number | undefined

/**
 * 只刷新服务端运行状态，不调用 applyScheduleResult()。
 *
 * 原因：用户可能正在编辑尚未保存的检测时间。如果轮询时把服务器值重新写回 schedule，
 * 会把用户正在编辑的内容覆盖掉。因此轮询只更新 scheduleSetting，表单仍由用户控制。
 */
async function refreshScheduleStatus() {
  try {
    scheduleSetting.value = await api.priceCheckSchedule()
  } catch (error) {
    // 后台轮询失败只记控制台，不连续弹 Toast 干扰运营操作。
    console.warn('刷新自动检测状态失败', error)
  }
}

onMounted(async () => {
  await load()

  scheduleRefreshTimer = window.setInterval(
    refreshScheduleStatus,
    SCHEDULE_STATUS_REFRESH_MS,
  )
})

onUnmounted(() => {
  if (scheduleRefreshTimer !== undefined) {
    window.clearInterval(scheduleRefreshTimer)
  }
})
</script>

<template>
  <section>
    <div class="page-head">
      <div>
        <h2>系统设置</h2>
        <p>
          自动检测时间保存到 D1 后立即生效；修改计划不需要重新部署 Worker。
          敏感 Token 不会完整回传浏览器。
        </p>
      </div>
    </div>

    <el-card class="settings-card schedule-card">
      <template #header>
        <div class="card-header">
          <div>
            <strong>自动价格检测</strong>
            <small>按指定时区和时间自动检测所有已启用 Monitor</small>
          </div>
          <el-switch
            v-model="schedule.enabled"
            active-text="已启用"
            inactive-text="已停用"
          />
        </div>
      </template>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        class="schedule-explain"
      >
        <template #title>
          Cloudflare Cron 每分钟只检查一次“当前时间是否命中计划”；未命中时不会请求喵喵折。
        </template>
      </el-alert>

      <el-form label-width="110">
        <el-form-item label="计划时区">
          <el-select
            v-model="schedule.timezone"
            filterable
            allow-create
            default-first-option
            placeholder="选择或输入 IANA 时区"
            class="schedule-timezone"
          >
            <el-option
              v-for="option in timezoneOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
          <div class="hint">
            支持 IANA 时区，例如 Asia/Shanghai。Cron 本身使用 UTC，但系统会自动换算。
          </div>
        </el-form-item>

        <el-form-item label="每日时间">
          <div class="schedule-time-editor">
            <div v-if="schedule.times.length" class="schedule-time-tags">
              <el-tag
                v-for="time in schedule.times"
                :key="time"
                closable
                size="large"
                @close="removeScheduleTime(time)"
              >
                {{ time }}
              </el-tag>
            </div>
            <el-empty
              v-else
              :image-size="54"
              description="还没有检测时间"
              class="schedule-empty"
            />

            <div class="schedule-add-row">
              <el-time-picker
                v-model="newScheduleTime"
                format="HH:mm"
                value-format="HH:mm"
                placeholder="选择检测时间"
              />
              <el-button
                type="primary"
                plain
                :disabled="!newScheduleTime"
                @click="addScheduleTime"
              >
                添加时间
              </el-button>
              <el-button @click="restoreDefaultSchedule">
                恢复 09 / 15 / 21 点
              </el-button>
            </div>
          </div>
        </el-form-item>

        <el-form-item label="运行状态">
          <div class="schedule-status">
            <div>
              <span>上次自动检测</span>
              <strong>
                {{ scheduleSetting?.lastRunLocal || '尚未自动执行' }}
              </strong>
              <small v-if="scheduleSetting?.lastRun">
                投递 {{ scheduleSetting.lastRun.enqueued }} 条 Monitor
              </small>
            </div>
            <div>
              <span>下次自动检测</span>
              <strong>
                {{ schedule.enabled
                  ? (scheduleSetting?.nextRunLocal || '保存后计算')
                  : '自动检测已停用' }}
              </strong>
              <small>{{ schedule.timezone }}</small>
            </div>
          </div>
          <div class="hint">
            运行状态每 10 秒自动刷新；“下次自动检测”基于最近一次已保存计划计算，编辑时间后点击保存会立即重新计算。
          </div>
        </el-form-item>

        <el-form-item>
          <el-button
            type="primary"
            :loading="savingSchedule"
            @click="saveSchedule"
          >
            保存检测计划
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="settings-card">
      <template #header>喵喵折 Token</template>

      <p>
        当前：<b>{{ tokenSetting?.configured ? tokenSetting.maskedToken : '未配置' }}</b>
        <span class="hint">来源：{{ tokenSetting?.source || '-' }}</span>
      </p>

      <el-form label-width="110">
        <el-form-item label="新 Token">
          <el-input v-model="token" type="password" show-password />
        </el-form-item>
        <el-form-item label="首次验证链接">
          <el-input
            v-model="validationUrl"
            placeholder="数据库已有商品时可留空"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="saveToken">验证并保存</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="settings-card">
      <template #header>管理员账号</template>

      <el-form label-width="110">
        <el-form-item label="当前密码">
          <el-input
            v-model="account.currentPassword"
            type="password"
            show-password
          />
        </el-form-item>
        <el-form-item label="新账号">
          <el-input
            v-model="account.username"
            placeholder="留空表示不修改"
          />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input
            v-model="account.newPassword"
            type="password"
            show-password
            placeholder="留空表示不修改，至少8位"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="saveAccount">保存账号设置</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </section>
</template>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.card-header > div {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.card-header small {
  color: #909399;
  font-weight: normal;
}

.schedule-card {
  max-width: 900px;
}

.schedule-explain {
  margin-bottom: 20px;
}

.schedule-timezone {
  width: 360px;
}

.schedule-time-editor {
  width: 100%;
}

.schedule-time-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  min-height: 34px;
  margin-bottom: 14px;
}

.schedule-empty {
  width: 260px;
  padding: 0 0 12px;
}

.schedule-add-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.schedule-status {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.schedule-status > div {
  min-height: 82px;
  padding: 14px 16px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #fafcff;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.schedule-status span,
.schedule-status small {
  color: #909399;
  font-size: 12px;
}

.schedule-status strong {
  color: #303133;
  font-size: 16px;
}
</style>
