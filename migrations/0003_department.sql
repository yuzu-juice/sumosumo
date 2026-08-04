-- 0003_department.sql
-- 医療機関の診療科目カラムを追加
ALTER TABLE facilities ADD COLUMN department TEXT;
