<script setup lang="ts">
/** 站内信列表。每次价格检测结果为 violation 时生成新的违规通知。 */
import { onMounted, onUnmounted, ref } from 'vue'
import { ElMessage } from 'element-plus'

import { api, type Notification } from '../api'
import { confirmDanger, showError } from '../ui'

const rows = ref<Notification[]>([])

async function load(showToast = true) {
  try {
    rows.value = await api.notifications()
  } catch (error) {
    if (showToast) {
      showError(error)
    } else {
      // 后台轮询失败不弹 Toast，避免网络抖动时重复打扰用户。
      console.warn('刷新站内信失败', error)
    }
  }
}

const NOTIFICATION_REFRESH_MS = 10_000
let notificationRefreshTimer: number | undefined

async function refreshNotifications() {
  await load(false)
}

async function markRead(row: Notification) {
  if (row.read) return

  try {
    await api.readNotification(row.id)
    row.read = true
  } catch (error) {
    showError(error)
  }
}

async function markAllRead() {
  try {
    await api.readAllNotifications()
    rows.value.forEach((row) => {
      row.read = true
    })
    ElMessage.success('已全部标记为已读')
  } catch (error) {
    showError(error)
  }
}

async function remove(row: Notification) {
  try {
    await confirmDanger(`删除通知“${row.title}”？`)
    await api.deleteNotification(row.id)
    await load()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    showError(error)
  }
}

onMounted(async () => {
  await load()

  notificationRefreshTimer = window.setInterval(
    refreshNotifications,
    NOTIFICATION_REFRESH_MS,
  )
})

onUnmounted(() => {
  if (notificationRefreshTimer !== undefined) {
    window.clearInterval(notificationRefreshTimer)
  }
})
</script>

<template>
  <section>
    <div class="page-head">
      <div>
        <h2>站内信</h2>
        <p>每次价格检测结果为 violation 时生成违规通知。</p>
      </div>
      <el-button @click="markAllRead">全部已读</el-button>
    </div>

    <el-table :data="rows" stripe @row-click="markRead">
      <el-table-column label="状态" width="80">
        <template #default="{ row }">
          <el-tag :type="row.read ? 'info' : 'danger'">
            {{ row.read ? '已读' : '未读' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="title" label="标题" min-width="180" />
      <el-table-column prop="content" label="内容" min-width="460" />
      <el-table-column label="操作" width="80">
        <template #default="{ row }">
          <el-button link type="danger" @click.stop="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </section>
</template>
