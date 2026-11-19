<script setup>
import ManageShell from '../../components/ManageShell.vue'
import BirthdayList from '../../components/BirthdayList.vue'
import { ensureOrders } from '../../data/store'
// วันเกิดมาจากออร์เดอร์ทุกช่วงเวลา: ดึงเฉพาะออร์เดอร์ที่มีวันเกิด (แทนประวัติทั้งหมด)
ensureOrders({ birthdays: true })
</script>

<template>
  <ManageShell title="เตือนวันเกิด" :toolbar="false">
    <section class="card">
      <BirthdayList />
    </section>
  </ManageShell>
</template>
