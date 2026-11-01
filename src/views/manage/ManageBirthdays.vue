<script setup>
import ManageShell from '../../components/ManageShell.vue'
import BirthdayList from '../../components/BirthdayList.vue'
</script>

<template>
  <ManageShell title="เตือนวันเกิด" :toolbar="false">
    <section class="card">
      <BirthdayList />
    </section>
  </ManageShell>
</template>
