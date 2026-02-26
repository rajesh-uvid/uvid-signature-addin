
CREATE TABLE script_details (
    script_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    script_name VARCHAR(255) NOT NULL,
    frequency VARCHAR(50),
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (script_id),
    UNIQUE KEY uk_script_name (script_name)
)


CREATE TABLE script_audit_log (
    log_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    script_id INT UNSIGNED NOT NULL,
    start_time DATETIME(3) NOT NULL,
    end_time DATETIME(3) DEFAULT NULL,
    status ENUM('Running', 'Success', 'Failed', 'Crashed', 'Timeout') DEFAULT 'Running',
    load_date DATE NOT NULL,
    load_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (log_id, load_date),
    INDEX idx_script_date (script_id, load_date),
    INDEX idx_date_script (load_date, script_id),
    CONSTRAINT fk_script_audit FOREIGN KEY (script_id) REFERENCES script_details(script_id)
) 
PARTITION BY RANGE COLUMNS(load_date) (
    PARTITION p_2024_01 VALUES LESS THAN ('2024-02-01'),
    PARTITION p_2024_02 VALUES LESS THAN ('2024-03-01'),
    PARTITION p_future VALUES LESS THAN (MAXVALUE)
);
The use of ENUM for the status field provides immediate performance gains. Each status is stored as a 1-byte integer internally, and the database engine enforces that only valid status values are entered. This eliminates the "dirty data" problem associated with VARCHAR fields where "success", "SUCCESS", and "Success" might be recorded as different states.Optimized Analytical ViewThe view is refactored to use a Common Table Expression (CTE) and a Window Function. This approach is highly performant in MySQL 8.0 and provides better readability for complex logic.SQLCREATE OR REPLACE VIEW vw_script_audit_summary AS
WITH LatestExecution AS (
    SELECT 
        script_id,
        log_id,
        start_time,
        end_time,
        status,
        -- Use window function to identify the latest record for each script
        ROW_NUMBER() OVER(PARTITION BY script_id ORDER BY log_id DESC) as rec_rank
    FROM script_audit_log
    WHERE load_date >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
)
SELECT 
    s.script_name,
    l.start_time,
    l.end_time,
    CASE 
        WHEN l.log_id IS NULL THEN 'MISSING (No recent trigger)'
        WHEN l.status = 'Running' AND l.start_time < DATE_SUB(NOW(3), INTERVAL 4 HOUR) 
             THEN 'FAILED (Potential Hang)'
        ELSE l.status 
    END AS final_status
FROM script_details s
LEFT JOIN LatestExecution l ON s.script_id = l.script_id AND l.rec_rank = 1
WHERE s.is_active = 1;
This view logic explicitly handles the scenario where a script might be "stuck" in a running state. By comparing the start_time to the current time, the view can proactively mark a script as failed if it has exceeded its expected execution window.State-Aware Stored ProcedureThe stored procedure is redesigned to follow the Stateful Update pattern. It uses an INOUT parameter to pass the log_id back to the application, ensuring that the completion of a script updates the correct record.SQLDELIMITER //

CREATE PROCEDURE sp_manage_audit_log(
    IN p_script_id INT UNSIGNED,
    IN p_action ENUM('START', 'END'),
    IN p_status VARCHAR(20),
    INOUT p_log_id BIGINT UNSIGNED
)
SQL SECURITY DEFINER
BEGIN
    DECLARE v_now DATETIME(3) DEFAULT NOW(3);
    DECLARE v_today DATE DEFAULT CURDATE();

    IF p_action = 'START' THEN
        -- Create the initial 'Running' record
        INSERT INTO script_audit_log (script_id, start_time, status, load_date)
        VALUES (p_script_id, v_now, 'Running', v_today);
        
        -- Return the ID to the calling application
        SET p_log_id = LAST_INSERT_ID();
        
    ELSEIF p_action = 'END' THEN
        -- Attempt to update based on log_id first
        IF p_log_id IS NOT NULL THEN
            UPDATE script_audit_log 
            SET end_time = v_now,
                status = COALESCE(p_status, 'Success')
            WHERE log_id = p_log_id AND load_date = v_today;
        ELSE
            -- Fallback: Update the most recent 'Running' entry for this script
            UPDATE script_audit_log 
            SET end_time = v_now,
                status = COALESCE(p_status, 'Success')
            WHERE script_id = p_script_id 
              AND status = 'Running' 
              AND end_time IS NULL
            ORDER BY log_id DESC LIMIT 1;
        END IF;
    END IF;
END //

DELIMITER ;
This procedure is significantly more robust. The use of COALESCE provides a default 'Success' status if the application doesn't specify one, and the SQL SECURITY DEFINER ensures the audit trail cannot be easily bypassed.Integrated Operational ConclusionThe transition from a rudimentary auditing script to a high-performance database architecture requires a deep understanding of the underlying storage engine and optimizer behavior. In the context of MySQL 8.0, the move away from subqueries toward window functions, the implementation of state-aware stored procedures, and the strategic use of partitioning are not merely optional enhancements but essential requirements for any system intended to operate at scale.By unifying the schema naming, adopting the Stateful Update pattern, and leveraging the power of B-Tree indexing and date-based partitioning, an organization can transform its script monitoring from a point of failure into a source of competitive advantage. The resulting system provides the precision required for millisecond-level performance tuning, the security needed for regulatory compliance, and the scalability to manage the growth of corporate automation for years to come.