const jobs = new Map();

function createJob(id, type) {
  const job = { id, type, status: 'pending', progress: 0, stage: '', error: null, result: null };
  jobs.set(id, job);
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

function updateJob(id, fields) {
  const job = jobs.get(id);
  if (job) Object.assign(job, fields);
  return job;
}

module.exports = { createJob, getJob, updateJob };
